// Token radar model (radar-5): one snapshot in, one board ranked by expected dollars per hour out.
// Deterministic, standard library only, no protocol is ever named in the model.
//
// Peer set: every protocol whose mcap_usd is not null (and whose category is not CEX, whose TVL is a reserve
// figure, not a deposit) is "tokenised". All other non-CEX protocols are the pre-token pool.
//
// 1. Token odds. Labelled pool = every non-CEX protocol, label = tokenised. Three nested strata: category,
//    category x TVL bucket, category x TVL bucket x age bucket. Category rate is Laplace smoothed
//    ((k+1)/(n+2)); each finer stratum shrinks toward the one above it, (k + m*parent)/(n + m). Support rule: an
//    estimate is never taken from a stratum with fewer than 8 tokenised peers; it pools down finest -> category ->
//    global until at least 8 tokenised peers stand behind it, and the level and peer counts are recorded on the row.
//    Clipped to 2-95%. A protocol never counts toward its own odds. (Logistic candidates are scored for calibration only; see validate().)
// 2. Implied value = TVL x category median(mcap/TVL of tokenised peers; global median under 5 peers)
//    x growth factor x age factor, the multiple clipped to 0.3-3.0x. p10 is floored at 0.05x TVL and p90 capped at 20x TVL. growth = exp(b_g * (g - mean g)) bounded
//    0.8-1.25 with g = ln(1 + 7d change clamped to -50%..+100%); age = exp(b_a * (a - mean a)), a = min(days
//    listed, 1095) / 1095. b_g and b_a are the least-squares fit of ln(ratio / category median) on the tokenised
//    set. p10-p90 = implied x exp(-/+ z * sigma_eff), sigma = robust dispersion (1.4826 MAD) of ln(mcap/TVL)
//    among the same peers, sigma_eff = sigma * sqrt(1 + 4/n): wider when peers are few.
// 3. Validation (validate()): walk-forward (oldest 70% by listed_at train, newest 30% test), leave-one-out on
//    the whole fit (medians and coefficients), and the Brier score of the odds model against the tokenised label,
//    leave-one-out too, next to the Brier score of the leave-one-out global base rate.
// 4. Farm verdict: 3-6 costed steps. expected_usd = min(p(token) x implied x capture, wallet cap), capture 5 bps,
//    cap $12,000 per wallet (the only cap); gross $/hr = expected / max(hours, 0.5), uncapped, at p50 and p10.
//    gas_usd = sum of the gas items in the steps (deposits and bridge fees excluded); net = expected - gas;
//    net $/hr = net / max(hours, 0.5). Capital (deposits) is not subtracted: it is shown as capital at risk.
//    Verdict thresholds are quantiles of net_per_hr_p50 over the board itself, computed at build time
//    (linear interpolation, rounded to cents): q90 and q50.
//    FARM: net_per_hr_p50 >= q90 and gas_usd <= 25 and p_token >= 0.05;
//    WATCH: net_per_hr_p50 >= q50 and not FARM; else SKIP. Every row carries a short verdict_reason.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'radar-6';
export const EARLY_ROWS = 160;

export const PARAMS = {
  capture: 0.0005,
  wallet_cap_usd: 12000,
  hours_floor: 0.5,
  laplace: 1,
  shrink_m: 4,
  p_min: 0.02,
  p_max: 0.95,
  min_peers: 5,
  multiple_min: 0.3,
  multiple_max: 3.0,
  growth_min: 0.8,
  growth_max: 1.25,
  growth_rate_min: -0.5,
  growth_rate_max: 1.0,
  age_saturation_days: 1095,
  z_p90: 1.2815516,
  widen_k: 4,
  sigma_floor: 0.15,
  tvl_edges: [10_000_000, 50_000_000, 300_000_000],
  age_edges: [180, 540],
  train_share: 0.7,
  min_support: 8,
  implied_p10_floor: 0.05,
  implied_p90_cap: 20,
  farm_quantile: 0.9,
  farm_max_gas_usd: 25,
  farm_min_p: 0.05,
  watch_quantile: 0.5,
};

export type Kind = 'lending' | 'dex' | 'perp' | 'bridge' | 'restaking' | 'yield' | 'chain';
export type Risk = 'Low' | 'Medium' | 'High';
export type Verdict = 'FARM' | 'WATCH' | 'SKIP';

export interface Step {
  action: string;
  deposit_usd: number;
  gas_usd: number;
  bridge_usd: number;
  minutes: number;
  risk: Risk;
}

export interface Stratum {
  label: string;
  n: number;
  k: number;
  rate: number;
}

export type SupportLevel = 'finest' | 'category' | 'global';

export interface Odds {
  p: number;
  /** Peers and tokenised peers behind the estimate, at the level actually used. */
  n: number;
  k: number;
  level: SupportLevel;
  global: { n: number; k: number; rate: number };
  strata: Stratum[];
  p_category: number;
  p_tvl: number;
  p_age: number;
  clipped: boolean;
}

export interface Fit {
  b_growth: number;
  b_age: number;
  mean_growth: number;
  mean_age: number;
  n: number;
  r2: number;
}

export interface CatStat {
  n: number;
  median: number;
  sigma: number;
}

export interface Row {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  kind: Kind;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watch: boolean;
  age_days: number | null;
  p_token: number;
  peer_count: number;
  peer_tokenised: number;
  support_level: SupportLevel;
  support_text: string;
  odds: Odds;
  implied_value_usd: number;
  implied_p10_usd: number;
  implied_p90_usd: number;
  p10_clamped: boolean;
  p90_clamped: boolean;
  band_low_usd: number;
  band_high_usd: number;
  multiple: number;
  value: {
    peer_key: string;
    peer_n: number;
    category_median: number;
    growth_factor: number;
    age_factor: number;
    raw_multiple: number;
    clipped: boolean;
    sigma: number;
    sigma_eff: number;
    z: number;
  };
  steps: Step[];
  farm_steps: string[];
  total_cost_usd: number;
  total_hours: number;
  farm_total_cost_usd: number;
  farm_total_minutes: number;
  capture: number;
  wallet_cap_usd: number;
  expected_usd_raw: number;
  expected_usd: number;
  expected_usd_p50: number;
  expected_usd_p10: number;
  capped: boolean;
  gas_usd: number;
  bridge_usd: number;
  capital_at_risk_usd: number;
  usd_per_hr_p50: number;
  usd_per_hr_p10: number;
  net_usd_p50: number;
  net_usd_p10: number;
  net_per_hr_p50: number;
  net_per_hr_p10: number;
  verdict: Verdict;
  verdict_reason: string;
  why: string;
  risk_note: string;
}

export interface Integrity {
  protocols_scored: number;
  peers_used: number;
  pool_size: number;
  walk_forward_ratio: number;
  leave_one_out_ratio: number;
  brier_model: number;
  brier_base: number;
  walk_forward_train: number;
  walk_forward_test: number;
  walk_forward_p10_p90_coverage: number;
  brier_n: number;
  brier_base_rate: number;
  brier_model_test: number;
  brier_base_test: number;
  brier_stratified_test: number;
  brier_test_n: number;
  odds_model: 'logistic' | 'stratified';
  brier_plain_test: number;
  brier_rich_test: number;
  calib_model: 'base-rate' | 'plain-3' | 'rich';
  calib_val_brier: number;
  calib_val_n: number;
  calib_val_briers: Record<'base-rate' | 'plain-3' | 'rich', number>;
  calib_test_brier: number;
  calib_base_test: number;
  calib_n: number;
  calib_features: string[];
  calib_line: string;
  logistic_beats_base: boolean;
  verdict_counts: Record<Verdict, number>;
  support_counts: Record<SupportLevel, number>;
  verdict_violations: number;
  q50_net_per_hr: number;
  q90_net_per_hr: number;
  as_of: string;
  method: string;
  wf_median_ratio: number;
  wf_ratio_of_medians: number;
  wf_inside: number;
  wf_n: number;
  kpis: Kpis;
  accounting: Accounting;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  params: typeof PARAMS;
  integrity: Integrity;
  fit: Fit;
  categories: Record<string, CatStat>;
  global: CatStat;
  peer_sets: Record<string, { n: number; median: number; sigma: number; members: [string, number, number][] }>;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: Row[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const r2 = (n: number): number => Math.round(n * 100) / 100;
const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const bySlug = (a: { slug: string }, b: { slug: string }): number => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function kindOf(category: string | null): Kind {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('borrow')) return 'lending';
  if (c.includes('perp') || c.includes('derivative') || c.includes('option')) return 'perp';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('restak') || c.includes('staking')) return 'restaking';
  if (c.includes('dex') || c.includes('amm') || c.includes('swap') || c.includes('liquidity manager')) return 'dex';
  if (c === 'chain') return 'chain';
  return 'yield';
}

const catKey = (c: string | null): string => c ?? 'Uncategorised';
export const isTokenised = (p: SnapshotProtocol): boolean => finite(p.mcap_usd) && p.mcap_usd > 0;
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

// ---------------------------------------------------------------- token odds

const tvlBucket = (tvl: number): number => PARAMS.tvl_edges.filter((e) => tvl >= e).length;
const ageBucket = (age: number | null): number => (age === null ? 3 : PARAMS.age_edges.filter((e) => age >= e).length);
const usdShort = (n: number): string => (n >= 1e9 ? `$${n / 1e9}B` : n >= 1e6 ? `$${n / 1e6}M` : `$${n / 1e3}K`);
const TVL_LABELS = ((): string[] => {
  const e = PARAMS.tvl_edges;
  return [`TVL < ${usdShort(e[0]!)}`, `TVL ${usdShort(e[0]!)}-${usdShort(e[1]!)}`, `TVL ${usdShort(e[1]!)}-${usdShort(e[2]!)}`, `TVL ≥ ${usdShort(e[2]!)}`];
})();
const AGE_LABELS = [`age < ${PARAMS.age_edges[0]} d`, `age ${PARAMS.age_edges[0]}-${PARAMS.age_edges[1]} d`, `age ≥ ${PARAMS.age_edges[1]} d`, 'age unknown'];

interface PoolEntry {
  slug: string;
  cat: string;
  tb: number;
  ab: number;
  y: number;
  l: LRow;
  listed: string | null;
}

function poolOf(snapshot: Snapshot): PoolEntry[] {
  return snapshot.protocols
    .filter((p) => p.category !== 'CEX' && finite(p.tvl_usd) && p.tvl_usd > 0)
    .map((p) => ({ slug: p.slug, cat: catKey(p.category), tb: tvlBucket(p.tvl_usd), ab: ageBucket(ageDays(snapshot.as_of, p.listed_at)), y: isTokenised(p) ? 1 : 0, l: { tvl: p.tvl_usd, age: ageDays(snapshot.as_of, p.listed_at), change: p.change_7d, cat: catKey(p.category), y: isTokenised(p) ? 1 : 0 }, listed: p.listed_at }));
}

/** Odds that `e` is tokenised, from the pool without `e` itself, pooled down until >= min_support tokenised peers. */
export function oddsFor(pool: PoolEntry[], e: Pick<PoolEntry, 'slug' | 'cat' | 'tb' | 'ab'>): Odds {
  let n0 = 0, k0 = 0, n1 = 0, k1 = 0, n2 = 0, k2 = 0, n3 = 0, k3 = 0;
  for (const q of pool) {
    if (q.slug === e.slug) continue;
    n0++; k0 += q.y;
    if (q.cat !== e.cat) continue;
    n1++; k1 += q.y;
    if (q.tb !== e.tb) continue;
    n2++; k2 += q.y;
    if (q.ab !== e.ab) continue;
    n3++; k3 += q.y;
  }
  const m = PARAMS.shrink_m;
  const pGlobal = (k0 + PARAMS.laplace) / (n0 + 2 * PARAMS.laplace);
  const pCat = (k1 + PARAMS.laplace) / (n1 + 2 * PARAMS.laplace);
  const pTvl = (k2 + m * pCat) / (n2 + m);
  const pAge = (k3 + m * pTvl) / (n3 + m);
  let level: SupportLevel = 'global';
  let raw = pGlobal, n = n0, k = k0;
  if (k3 >= PARAMS.min_support) { level = 'finest'; raw = pAge; n = n3; k = k3; }
  else if (k1 >= PARAMS.min_support) { level = 'category'; raw = pCat; n = n1; k = k1; }
  const p = clamp(raw, PARAMS.p_min, PARAMS.p_max);
  const rate = (kk: number, nn: number): number => (nn === 0 ? 0 : kk / nn);
  return {
    p: r4(p),
    n,
    k,
    level,
    global: { n: n0, k: k0, rate: r4(rate(k0, n0)) },
    strata: [
      { label: e.cat, n: n1, k: k1, rate: r4(rate(k1, n1)) },
      { label: `+ ${TVL_LABELS[e.tb]}`, n: n2, k: k2, rate: r4(rate(k2, n2)) },
      { label: `+ ${AGE_LABELS[e.ab]}`, n: n3, k: k3, rate: r4(rate(k3, n3)) },
    ],
    p_category: r4(pCat),
    p_tvl: r4(pTvl),
    p_age: r4(pAge),
    clipped: p !== raw,
  };
}

export const supportText = (o: Pick<Odds, 'level' | 'n' | 'k'>): string => `support: ${o.level}, ${o.n} peers (${o.k} tokenised)`;

// ---------------------------------------------------------------- logistic candidates (calibration only)

export interface LRow {
  tvl: number;
  age: number | null;
  change: number | null;
  cat: string;
  y: number;
}

export type CalibName = 'base-rate' | 'plain-3' | 'rich';
export const TOP_CATS = 6;

/** Base columns: log TVL, age in years (0 when unknown), 7d change in percent clipped to [-50, 100]. */
function baseCols(r: LRow): number[] {
  return [Math.log(r.tvl), r.age === null ? 0 : r.age / 365.25, finite(r.change) ? clamp(r.change, -50, 100) : 0];
}

export interface Logit {
  name: CalibName;
  features: string[];
  cats: string[];
  mean: number[];
  sd: number[];
  w: number[];
  b: number;
  base: number;
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

function design(m: { name: CalibName; cats: string[]; mean?: number[]; sd?: number[] }, r: LRow, std?: { mean: number[]; sd: number[] }): number[] {
  const [t, a, c] = baseCols(r) as [number, number, number];
  const raw = [t, a, c];
  if (m.name === 'rich') {
    // interaction of the standardised log TVL and age; the cats are the top six, "other" is the reference level
    const zt = (t - std!.mean[0]!) / std!.sd[0]!, za = (a - std!.mean[1]!) / std!.sd[1]!;
    raw.push(zt * za);
    for (const k of m.cats) raw.push(r.cat === k ? 1 : 0);
  }
  return raw;
}

/** Ridge-regularised logistic regression by batch gradient descent on standardised columns. name 'base-rate' fits the intercept only. */
export function fitLogit(rows: LRow[], name: CalibName, forceCats?: string[]): Logit {
  const n = rows.length;
  const base = rows.reduce((s, r) => s + r.y, 0) / n;
  const b0 = Math.log(Math.max(base, 1e-3) / Math.max(1 - base, 1e-3));
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.cat, (counts.get(r.cat) ?? 0) + 1);
  const cats = name === 'rich' && forceCats !== undefined ? forceCats : name === 'rich' ? [...counts].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, TOP_CATS).map((e) => e[0]) : [];
  const feats = name === 'rich'
    ? ['log TVL', 'age years', 'change 7d', 'log TVL x age', ...cats.map((k) => `cat:${k}`), 'cat:other (reference)']
    : name === 'plain-3' ? ['log TVL', 'age years', 'change 7d'] : [];
  if (name === 'base-rate') return { name, features: feats, cats, mean: [], sd: [], w: [], b: b0, base };
  // standardise the three base columns first (the interaction needs them), then every design column
  const bc = rows.map(baseCols);
  const bmean = [0, 1, 2].map((j) => bc.reduce((s, x) => s + x[j]!, 0) / n);
  const bsd = [0, 1, 2].map((j) => Math.sqrt(bc.reduce((s, x) => s + (x[j]! - bmean[j]!) ** 2, 0) / n) || 1);
  const X = rows.map((r) => design({ name, cats }, r, { mean: bmean, sd: bsd }));
  const d = X[0]!.length;
  const mean = Array.from({ length: d }, (_, j) => X.reduce((s, x) => s + x[j]!, 0) / n);
  const sd = Array.from({ length: d }, (_, j) => Math.sqrt(X.reduce((s, x) => s + (x[j]! - mean[j]!) ** 2, 0) / n) || 1);
  const Z = X.map((x) => x.map((v, j) => (v - mean[j]!) / sd[j]!));
  const w = new Array<number>(d).fill(0);
  let b = b0;
  const lambda = 0.01, lr = 0.5;
  for (let it = 0; it < 2000; it++) {
    const g = new Array<number>(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j]! * Z[i]![j]!;
      const e = sigmoid(z) - rows[i]!.y;
      gb += e;
      for (let j = 0; j < d; j++) g[j]! += e * Z[i]![j]!;
    }
    b -= (lr * gb) / n;
    for (let j = 0; j < d; j++) w[j] = w[j]! - lr * (g[j]! / n + lambda * w[j]!);
  }
  // keep the base-column standardisation inside mean/sd tail so predictions can rebuild the interaction
  return { name, features: feats, cats, mean: [...mean, ...bmean], sd: [...sd, ...bsd], w, b, base };
}

export function logitP(m: Logit, r: LRow): number {
  if (m.name === 'base-rate') return m.base;
  const d = m.w.length;
  const x = design(m, r, { mean: m.mean.slice(d), sd: m.sd.slice(d) });
  let z = m.b;
  for (let j = 0; j < d; j++) z += m.w[j]! * ((x[j]! - m.mean[j]!) / m.sd[j]!);
  return sigmoid(z);
}

// ---------------------------------------------------------------- implied value

interface Peer {
  slug: string;
  name: string;
  cat: string;
  tvl: number;
  mcap: number;
  ratio: number;
  logRatio: number;
  g: number | null;
  a: number | null;
  change: number | null;
  listed: string | null;
}

const growthFeature = (change: number | null): number | null =>
  finite(change) ? Math.log1p(clamp(change / 100, PARAMS.growth_rate_min, PARAMS.growth_rate_max)) : null;
const ageFeature = (age: number | null): number | null => (age === null ? null : Math.min(age, PARAMS.age_saturation_days) / PARAMS.age_saturation_days);

function peersOf(snapshot: Snapshot): Peer[] {
  return snapshot.protocols
    .filter((p) => p.category !== 'CEX' && isTokenised(p) && finite(p.tvl_usd) && p.tvl_usd > 0)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      cat: catKey(p.category),
      tvl: p.tvl_usd,
      mcap: p.mcap_usd!,
      ratio: p.mcap_usd! / p.tvl_usd,
      logRatio: Math.log(p.mcap_usd! / p.tvl_usd),
      g: growthFeature(p.change_7d),
      a: ageFeature(ageDays(snapshot.as_of, p.listed_at)),
      change: p.change_7d,
      listed: p.listed_at,
    }));
}

function stat(peers: Peer[]): CatStat {
  const lr = peers.map((q) => q.logRatio);
  const med = median(lr);
  const mad = median(lr.map((x) => Math.abs(x - med)));
  return { n: peers.length, median: median(peers.map((q) => q.ratio)), sigma: Math.max(PARAMS.sigma_floor, 1.4826 * mad) };
}

interface Trained {
  cats: Map<string, CatStat>;
  global: CatStat;
  fit: Fit;
}

function catStatOf(t: Trained, cat: string): { key: string; s: CatStat } {
  const s = t.cats.get(cat);
  return s !== undefined && s.n >= PARAMS.min_peers ? { key: cat, s } : { key: '*', s: t.global };
}

/** Category medians and dispersions, then the least-squares growth and age coefficients, from `train` alone. */
export function train(peers: Peer[]): Trained {
  const by = new Map<string, Peer[]>();
  for (const q of peers) by.set(q.cat, [...(by.get(q.cat) ?? []), q]);
  const cats = new Map([...by].map(([k, v]) => [k, stat(v)] as const));
  const global = stat(peers);
  const t: Trained = { cats, global, fit: { b_growth: 0, b_age: 0, mean_growth: 0, mean_age: 0, n: peers.length, r2: 0 } };
  const gs = peers.map((q) => q.g).filter(finite);
  const as = peers.map((q) => q.a).filter(finite);
  const mg = gs.length ? gs.reduce((s, x) => s + x, 0) / gs.length : 0;
  const ma = as.length ? as.reduce((s, x) => s + x, 0) / as.length : 0;
  const y = peers.map((q) => q.logRatio - Math.log(catStatOf(t, q.cat).s.median));
  const my = y.length ? y.reduce((s, x) => s + x, 0) / y.length : 0;
  let sgg = 0, sga = 0, saa = 0, sgy = 0, say = 0, syy = 0;
  peers.forEach((q, i) => {
    const g = q.g === null ? 0 : q.g - mg;
    const a = q.a === null ? 0 : q.a - ma;
    const d = y[i]! - my;
    sgg += g * g; sga += g * a; saa += a * a; sgy += g * d; say += a * d; syy += d * d;
  });
  const det = sgg * saa - sga * sga;
  let bg = 0, ba = 0;
  if (peers.length >= 3 && Math.abs(det) > 1e-12) {
    bg = (sgy * saa - say * sga) / det;
    ba = (say * sgg - sgy * sga) / det;
  }
  t.fit = { b_growth: bg, b_age: ba, mean_growth: mg, mean_age: ma, n: peers.length, r2: syy > 0 ? (bg * sgy + ba * say) / syy : 0 };
  return t;
}

export interface Valued {
  implied: number;
  p10: number;
  p90: number;
  p10_clamped: boolean;
  p90_clamped: boolean;
  multiple: number;
  peer_key: string;
  peer_n: number;
  category_median: number;
  growth_factor: number;
  age_factor: number;
  raw_multiple: number;
  clipped: boolean;
  sigma: number;
  sigma_eff: number;
}

export function valueOf(t: Trained, cat: string, tvl: number, change7d: number | null, age: number | null): Valued {
  const { key, s } = catStatOf(t, cat);
  const g = growthFeature(change7d);
  const a = ageFeature(age);
  const growth = clamp(Math.exp(t.fit.b_growth * (g === null ? 0 : g - t.fit.mean_growth)), PARAMS.growth_min, PARAMS.growth_max);
  const ageF = Math.exp(t.fit.b_age * (a === null ? 0 : a - t.fit.mean_age));
  const raw = s.median * growth * ageF;
  const multiple = clamp(raw, PARAMS.multiple_min, PARAMS.multiple_max);
  const implied = Math.max(1, Math.round(tvl * multiple));
  const sigmaEff = s.sigma * Math.sqrt(1 + PARAMS.widen_k / s.n);
  const lo = Math.round(implied * Math.exp(-PARAMS.z_p90 * sigmaEff));
  const hi = Math.round(implied * Math.exp(PARAMS.z_p90 * sigmaEff));
  const floor = Math.max(1, Math.round(tvl * PARAMS.implied_p10_floor));
  const cap = Math.max(implied, Math.round(tvl * PARAMS.implied_p90_cap));
  return {
    implied,
    p10: Math.min(implied, Math.max(floor, lo)),
    p90: Math.min(cap, Math.max(implied, hi)),
    p10_clamped: lo < floor,
    p90_clamped: hi > cap,
    multiple,
    peer_key: key,
    peer_n: s.n,
    category_median: s.median,
    growth_factor: growth,
    age_factor: ageF,
    raw_multiple: raw,
    clipped: raw !== multiple,
    sigma: s.sigma,
    sigma_eff: sigmaEff,
  };
}

// ---------------------------------------------------------------- validation

const ageAt = (asOf: string, q: Peer): number | null => ageDays(asOf, q.listed);

export function validate(snapshot: Snapshot): Integrity {
  const peers = peersOf(snapshot);
  const asOf = snapshot.as_of;
  const predict = (t: Trained, q: Peer): Valued => valueOf(t, q.cat, q.tvl, q.change, ageAt(asOf, q));

  // (a) walk-forward: oldest 70% by listed_at train, newest 30% test
  const dated = peers.filter((q) => q.listed !== null).sort((a, b) => (a.listed! < b.listed! ? -1 : a.listed! > b.listed! ? 1 : a.slug < b.slug ? -1 : 1));
  const cut = Math.floor(dated.length * PARAMS.train_share);
  const tr = train(dated.slice(0, cut));
  const test = dated.slice(cut);
  const preds = test.map((q) => predict(tr, q));
  const wf = median(preds.map((v) => v.implied)) / median(test.map((q) => q.mcap));
  const wfMedian = median(test.map((q, i) => preds[i]!.implied / q.mcap));
  const insideN = test.filter((q, i) => q.mcap >= preds[i]!.p10 && q.mcap <= preds[i]!.p90).length;
  const inside = test.filter((q, i) => q.mcap >= preds[i]!.p10 && q.mcap <= preds[i]!.p90).length / test.length;

  // (b) leave-one-out on the coefficient fit (medians and coefficients refit without the held-out peer)
  const loo = peers.map((q) => predict(train(peers.filter((o) => o !== q)), q).implied);
  const looRatio = median(loo) / median(peers.map((q) => q.mcap));

  // (c) Brier score of the odds model against the tokenised label, leave-one-out, next to the base rate
  const pool = poolOf(snapshot);
  const K = pool.reduce((s, e) => s + e.y, 0);
  let bm = 0, bb = 0;
  for (const e of pool) {
    const p = oddsFor(pool, e).p;
    bm += (p - e.y) ** 2;
    const base = (K - e.y) / (pool.length - 1);
    bb += (base - e.y) ** 2;
  }
  // (d) walk-forward Brier: logistic on three standardised features, oldest 70% of the pool train, newest 30% test,
  //     scored against the train base rate and the stratified rate on the same test rows
  const pdated = pool.filter((e) => e.listed !== null).sort((a, b) => (a.listed! < b.listed! ? -1 : a.listed! > b.listed! ? 1 : a.slug < b.slug ? -1 : 1));
  const pcut = Math.floor(pdated.length * PARAMS.train_share);
  const ptrain = pdated.slice(0, pcut);
  const ptest = pdated.slice(pcut);
  const trainRate = ptrain.reduce((s, e) => s + e.y, 0) / ptrain.length;
  const clip = (p: number): number => clamp(p, PARAMS.p_min, PARAMS.p_max);
  const brierOf = (m: Logit, rows: PoolEntry[]): number => rows.reduce((s, e) => s + (clip(logitP(m, e.l)) - e.l.y) ** 2, 0) / rows.length;
  // model choice on a validation slice inside the training 70%: fit on its oldest 70%, validate on its newest 30%
  const vcut = Math.floor(ptrain.length * PARAMS.train_share);
  const sub = ptrain.slice(0, vcut), val = ptrain.slice(vcut);
  const names: CalibName[] = ['base-rate', 'plain-3', 'rich'];
  const valB = {} as Record<CalibName, number>;
  for (const nm of names) valB[nm] = brierOf(fitLogit(sub.map((e) => e.l), nm), val);
  let chosen: CalibName = 'base-rate';
  for (const nm of names) if (valB[nm] < valB[chosen]) chosen = nm;
  // test: all three refit on the full training 70%; the chosen one is the reported calibration
  const fits = {} as Record<CalibName, Logit>;
  const testB = {} as Record<CalibName, number>;
  for (const nm of names) { fits[nm] = fitLogit(ptrain.map((e) => e.l), nm); testB[nm] = r4(brierOf(fits[nm], ptest)); }
  let tb = 0, ts = 0;
  for (const e of ptest) {
    tb += (trainRate - e.y) ** 2;
    ts += (oddsFor(ptrain, e).p - e.y) ** 2;
  }
  const brierModelTest = testB['plain-3'];
  const brierBaseTest = r4(tb / ptest.length);
  const beats = testB[chosen] < brierBaseTest;
  const feats = fits[chosen].features;
  const calibLine = `calibration: ${chosen}${chosen === 'base-rate' ? ' (no logistic beat the base rate on validation)' : ''}; validation Brier ${r4(valB[chosen]).toFixed(4)} (n=${val.length}); test Brier ${testB[chosen].toFixed(4)} vs base rate ${brierBaseTest.toFixed(4)} (n=${ptest.length}); features: ${feats.length ? feats.join(', ') : 'none (intercept only)'}`;
  return {
    protocols_scored: 0,
    peers_used: peers.length,
    pool_size: pool.length,
    walk_forward_ratio: r4(wf),
    leave_one_out_ratio: r4(looRatio),
    brier_model: r4(bm / pool.length),
    brier_base: r4(bb / pool.length),
    walk_forward_train: cut,
    walk_forward_test: test.length,
    walk_forward_p10_p90_coverage: r4(inside),
    brier_n: pool.length,
    brier_base_rate: r4(K / pool.length),
    brier_model_test: brierModelTest,
    brier_base_test: brierBaseTest,
    brier_stratified_test: r4(ts / ptest.length),
    brier_test_n: ptest.length,
    odds_model: 'stratified',
    brier_plain_test: testB['plain-3'],
    brier_rich_test: testB.rich,
    calib_model: chosen,
    calib_val_brier: r4(valB[chosen]),
    calib_val_n: val.length,
    calib_val_briers: { 'base-rate': r4(valB['base-rate']), 'plain-3': r4(valB['plain-3']), rich: r4(valB.rich) },
    calib_test_brier: testB[chosen],
    calib_base_test: brierBaseTest,
    calib_n: ptest.length,
    calib_features: feats,
    calib_line: calibLine,
    logistic_beats_base: beats,
    verdict_counts: { FARM: 0, WATCH: 0, SKIP: 0 },
    support_counts: { finest: 0, category: 0, global: 0 },
    verdict_violations: 0,
    q50_net_per_hr: 0,
    q90_net_per_hr: 0,
    as_of: asOf,
    wf_median_ratio: r4(wfMedian),
    wf_ratio_of_medians: r4(wf),
    wf_inside: insideN,
    wf_n: test.length,
    kpis: null as unknown as Kpis,
    accounting: null as unknown as Accounting,
    method:
      'walk-forward: oldest 70% of tokenised peers by listed_at train, newest 30% test, ratio = median predicted / median realised mcap; ' +
      'leave-one-out: medians and growth/age coefficients refit without each peer, same ratio over all peers; ' +
      'brier (brier_model, brier_base): leave-one-out stratified odds vs tokenised label over every non-CEX protocol, base = leave-one-out global rate; ' +
      'brier_*_test: three candidates (base rate; plain logistic on log TVL, age years, 7d change; rich logistic adding log TVL x age and top-six category indicators, all standardised) trained on oldest 70% of the pool by listed_at; the winner is chosen on a validation slice (newest 30% of that training block) and its test Brier on the newest 30% is reported against the train base rate; row odds use the support-pooled stratified rate (>= 8 tokenised peers, finest -> category -> global); the logistic candidates are calibration checks only',
  };
}

// ---------------------------------------------------------------- farm plans

function shortName(p: SnapshotProtocol): string {
  return p.name.length <= 28 ? p.name : `${p.name.slice(0, 26).trim()}…`;
}

function chainOf(p: SnapshotProtocol): string {
  const c = p.chains[0];
  return c !== undefined && c.length <= 24 ? c : 'its main chain';
}

/** Typical cost of one transaction on a chain, in dollars. */
function gasFor(chain: string): number {
  if (chain === 'Ethereum') return 6;
  if (['Base', 'Arbitrum', 'Optimism', 'Unichain', 'Linea', 'Scroll', 'Blast', 'zkSync Era'].includes(chain)) return 0.4;
  if (['Solana', 'Sui', 'Aptos', 'TON'].includes(chain)) return 0.05;
  return 0.8;
}

/** Typical fee of one bridge hop into a chain, in dollars. */
function bridgeFeeFor(chain: string): number {
  if (['Base', 'Arbitrum', 'Optimism', 'Unichain', 'Linea', 'Scroll', 'Blast', 'zkSync Era'].includes(chain)) return 2.5;
  if (['Solana', 'Sui', 'Aptos', 'TON'].includes(chain)) return 3.5;
  return 3;
}

function depositFor(tvl: number): number {
  if (tvl >= 1e9) return 250;
  if (tvl >= 1e8) return 150;
  if (tvl >= 2e7) return 100;
  return 50;
}

function holdFor(age: number | null): number {
  if (age === null) return 30;
  return age < 180 ? 60 : age < 365 ? 45 : 30;
}

interface Ctx {
  n: string;
  chain: string;
  cap: number;
  half: number;
  hold: number;
  weeks: number;
  gas: number;
  bridge: number;
  inb: number;
}

type Template = { req: boolean; make: (c: Ctx) => Step };
const st = (action: string, deposit: number, txs: number, c: Ctx, minutes: number, bridgeHops = 0): Omit<Step, 'risk'> & { risk: Risk } => {
  const s = { action, deposit_usd: deposit, gas_usd: r2(txs * c.gas), bridge_usd: r2(bridgeHops * c.bridge), minutes, risk: 'Low' as Risk };
  s.risk = stepRisk(s);
  return s;
};
const R = (make: (c: Ctx) => Step): Template => ({ req: true, make });
const O = (make: (c: Ctx) => Step): Template => ({ req: false, make });

const HIGH_RISK = /borrow|short|long |leverag|riskier|slash|unbond|lock |stop on|impermanent/i;
export function stepRisk(s: { action: string; deposit_usd: number; gas_usd: number; bridge_usd: number }): Risk {
  const spends = s.deposit_usd > 0 || s.gas_usd > 0 || s.bridge_usd > 0;
  if (!spends) return 'Low';
  if (HIGH_RISK.test(s.action)) return 'High';
  if (s.deposit_usd > 0 || /deploy|repay|withdraw|remove|rebalance|vote/i.test(s.action)) return 'Medium';
  return 'Low';
}

const PLANS: Record<Kind, Template[]> = {
  lending: [
    R((c) => st(`Open a fresh wallet on ${c.chain}, then supply USDC to the main market on ${c.n}.`, c.cap, 2, c, 15, c.inb)),
    R((c) => st(`Borrow a different stablecoin on ${c.n}, keeping the loan under 40% of collateral.`, 0, 1, c, 8)),
    R((c) => st(`Repay the loan on ${c.n} and re-supply, once a week for ${c.weeks} weeks.`, 0, 2 * c.weeks, c, 10 * c.weeks)),
    O((c) => st(`Check ${c.n}'s health factor twice a week; add collateral if it drops below 1.8.`, 0, 1, c, 4 * c.weeks)),
    O((c) => st(`Read ${c.n}'s docs and official posts for any points or rewards page; claim only from its own link.`, 0, 0, c, 20)),
    R((c) => st(`Withdraw and close the ${c.n} position after day ${c.hold}, then log the hashes.`, 0, 3, c, 12)),
  ],
  dex: [
    R((c) => st(`Swap USDC for the paired asset on ${c.n} (${c.chain}); keep price impact under 0.3%.`, c.half, 2, c, 10, c.inb)),
    R((c) => st(`Deposit both sides into ${c.n}'s highest-volume pool and keep the LP token.`, c.cap, 3, c, 12)),
    R((c) => st(`Trade once a week in both directions on ${c.n} for ${c.weeks} weeks to build volume.`, 0, 2 * c.weeks, c, 6 * c.weeks)),
    O((c) => st(`Check impermanent loss on ${c.n}; rebalance if the pair drifts over 10% from entry.`, 0, 2, c, 10)),
    O((c) => st(`Read ${c.n}'s official channel for any points rules; never sign a claim from a DM.`, 0, 0, c, 15)),
    R((c) => st(`Remove the liquidity from ${c.n} after day ${c.hold} and swap back to USDC.`, 0, 3, c, 10)),
  ],
  perp: [
    R((c) => st(`Deposit USDC as margin on ${c.n} (${c.chain}); keep at least 60% of it idle.`, c.cap, 2, c, 12, c.inb)),
    R((c) => st(`Open a small long on ${c.n} at 2x or less, then close it within a day.`, c.half, 2, c, 8)),
    R((c) => st(`Place an opposite short on ${c.n} once a week for ${c.weeks} weeks, never above 3x.`, 0, 2 * c.weeks, c, 8 * c.weeks)),
    O((c) => st(`Check ${c.n}'s volume tiers and keep monthly volume just above the first threshold.`, 0, 0, c, 10)),
    O((c) => st(`Read ${c.n}'s points or rewards rules from its own site and note the cutoff date.`, 0, 0, c, 15)),
    R((c) => st(`Withdraw the margin from ${c.n} after day ${c.hold} and note fees and funding paid.`, 0, 2, c, 10)),
  ],
  bridge: [
    R((c) => st(`Send a $5 test transfer through ${c.n} to ${c.chain} and wait for it to land.`, 5, 1, c, 15, 1)),
    R((c) => st(`Bridge USDC through ${c.n} into ${c.chain} and use it in one app there.`, c.cap, 2, c, 20, 1)),
    R((c) => st(`Compare ${c.n}'s fee and time with one rival route before each transfer.`, 0, 0, c, 10)),
    O((c) => st(`Repeat one ${c.n} transfer monthly for ${Math.ceil(c.hold / 30)} months to show steady use.`, c.half, 2, c, 20, 1)),
    O((c) => st(`Keep every ${c.n} receipt page; a hash and timestamp make a stuck transfer recoverable.`, 0, 0, c, 5)),
    R((c) => st(`Bridge a smaller amount back out through ${c.n} after two weeks.`, c.half, 1, c, 20, 1)),
  ],
  restaking: [
    R((c) => st(`Stake the native asset through ${c.n} on ${c.chain} and confirm the receipt token arrives.`, c.cap, 2, c, 15, c.inb)),
    R((c) => st(`Delegate the ${c.n} position to an operator with a clean slashing record.`, 0, 1, c, 10)),
    O((c) => st(`Put the receipt token into one integration that ${c.n} lists, if its exit queue is under ${c.hold} days.`, 0, 2, c, 15)),
    R((c) => st(`Note ${c.n}'s unbonding period and plan the exit request before day ${c.hold}.`, 0, 0, c, 8)),
    O((c) => st(`Check ${c.n}'s dashboard weekly for reward rate changes for ${c.weeks} weeks.`, 0, 0, c, 3 * c.weeks)),
    R((c) => st(`Request the ${c.n} withdrawal near day ${c.hold} and collect after the queue clears.`, 0, 2, c, 12)),
  ],
  yield: [
    R((c) => st(`Deposit USDC into the largest vault on ${c.n} (${c.chain}) and confirm the share token.`, c.cap, 2, c, 12, c.inb)),
    R((c) => st(`Read ${c.n}'s docs for deposit and withdrawal fees and any lock-up.`, 0, 0, c, 15)),
    O((c) => st(`Add to or rebalance the ${c.n} position once a week for ${c.weeks} weeks.`, 0, c.weeks, c, 5 * c.weeks)),
    O((c) => st(`Move a small slice into a second, riskier ${c.n} vault only after two weeks.`, c.half, 2, c, 10)),
    R((c) => st(`Claim ${c.n}'s earned yield at most once a week; each claim costs gas.`, 0, 1, c, 5)),
    R((c) => st(`Withdraw from ${c.n} after day ${c.hold} and note the realised yield.`, 0, 2, c, 10)),
  ],
  chain: [
    R((c) => st(`Bridge ETH or USDC to ${c.n} (${c.chain}) from an exchange or a major bridge.`, c.cap, 2, c, 20, 1)),
    R((c) => st(`Swap on one ${c.n} app each week for ${c.weeks} weeks.`, 0, c.weeks, c, 5 * c.weeks)),
    O((c) => st(`Make a lending deposit on ${c.n}'s largest market to show a second kind of use.`, c.half, 2, c, 12)),
    R((c) => st(`Mint a name or NFT on ${c.n} as a cheap proof of activity.`, 0, 1, c, 8)),
    O((c) => st(`Follow ${c.n}'s official channels; airdrop guides appear there first.`, 0, 0, c, 10)),
    R((c) => st(`Bridge the rest back out of ${c.n} after day ${c.hold}.`, 0, 2, c, 20, 1)),
  ],
};

const fmt = (n: number): string => (n >= 10 ? String(Math.round(n)) : String(Math.round(n * 100) / 100));

/** One step as the board prints it: action, cost, time, risk. */
export function stepText(s: Step): string {
  const parts: string[] = [];
  if (s.deposit_usd > 0) parts.push(`$${fmt(s.deposit_usd)} deposit`);
  if (s.gas_usd > 0) parts.push(`$${fmt(s.gas_usd)} gas`);
  if (s.bridge_usd > 0) parts.push(`$${fmt(s.bridge_usd)} bridge`);
  return `${s.action} Cost: ${parts.length ? parts.join(' + ') : '$0'}. Time: ${s.minutes} min. Risk: ${s.risk}.`;
}

export const stepCost = (s: Step): number => s.deposit_usd + s.gas_usd + s.bridge_usd;

export function farmPlan(p: SnapshotProtocol, age: number | null): Step[] {
  const chain = chainOf(p);
  const hold = holdFor(age);
  const cap = depositFor(p.tvl_usd);
  const ctx: Ctx = {
    n: shortName(p), chain, cap, half: Math.round(cap / 2), hold, weeks: Math.ceil(hold / 7),
    gas: gasFor(chain), bridge: bridgeFeeFor(chain), inb: chain === 'Ethereum' ? 0 : 1,
  };
  let extras = (p.tvl_usd >= 1e8 ? 1 : 0) + (age !== null && age < 180 ? 1 : 0);
  const chosen = PLANS[kindOf(p.category)].filter((t) => t.req || extras-- > 0);
  return chosen.slice(0, 6).map((t) => {
    const s = t.make(ctx);
    // Keep every printed step inside 40..300 characters.
    while (stepText(s).length > 300 && s.action.length > 60) s.action = `${s.action.slice(0, s.action.length - 12).trimEnd()}…`;
    return s;
  });
}

const RISK_NOTE: Record<Kind, string> = {
  lending: 'Liquidation if collateral falls; keep the loan small and check health twice a week.',
  dex: 'Impermanent loss and thin pools; keep price impact low and exit on schedule.',
  perp: 'Leverage can liquidate fast and funding costs add up; stay at 2x or less.',
  bridge: 'Bridge contracts are a classic loss point; send a test transfer first and keep amounts small.',
  restaking: 'Slashing and long unbonding queues lock capital; split operators and plan the exit early.',
  yield: 'Vault strategies can lose principal and some lock deposits; read the fee and lock-up terms.',
  chain: 'Gas and bridge costs eat small balances; activity guides can be scams, so use official channels only.',
};

// ---------------------------------------------------------------- the board

export interface Thresholds {
  q50: number;
  q90: number;
}

/** Linear-interpolated quantile of xs (type 7), rounded to cents. */
export function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return r2(s[lo]! + (s[Math.min(lo + 1, s.length - 1)]! - s[lo]!) * (i - lo));
}

export function thresholdsOf(netHrs: number[]): Thresholds {
  return { q50: quantile(netHrs, PARAMS.watch_quantile), q90: quantile(netHrs, PARAMS.farm_quantile) };
}

const dollars = (n: number): string => '$' + Math.round(n).toLocaleString('en-US');

/** Why a row fails FARM, as stated reasons; empty when it passes all three conditions. */
export function farmFailures(netHr: number, gas: number, p: number, t: Thresholds): string[] {
  const out: string[] = [];
  if (!(netHr >= t.q90)) out.push('below q90');
  if (!(gas <= PARAMS.farm_max_gas_usd)) out.push(`gas ${dollars(gas)} over the $${PARAMS.farm_max_gas_usd} cap`);
  if (!(p >= PARAMS.farm_min_p)) out.push(`p ${Math.round(p * 100)}% under ${Math.round(PARAMS.farm_min_p * 100)}%`);
  return out;
}

export function verdictOf(netHr: number, gas: number, p: number, t: Thresholds): Verdict {
  if (farmFailures(netHr, gas, p, t).length === 0) return 'FARM';
  return netHr >= t.q50 ? 'WATCH' : 'SKIP';
}

/** The row's one-line reason: "farmable", or what keeps it from FARM (and, for SKIP, from WATCH). */
export function reasonOf(netHr: number, gas: number, p: number, t: Thresholds): string {
  const fails = farmFailures(netHr, gas, p, t);
  if (fails.length === 0) return 'farmable';
  if (netHr < t.q50) return 'below q50';
  return fails.join('; ');
}

/** Re-derives every verdict and reason from the row's own figures and the board's quantiles. Returns the violations (must be empty). */
export function verdictAudit(board: Row[], t: Thresholds = thresholdsOf(board.map((r) => r.net_per_hr_p50))): string[] {
  const bad: string[] = [];
  for (const r of board) {
    const nh = r.net_per_hr_p50;
    if (r.verdict === 'FARM') {
      if (nh < t.q90) bad.push(`${r.slug}: FARM with net $/hr ${nh} < q90 ${t.q90}`);
      if (r.gas_usd > PARAMS.farm_max_gas_usd) bad.push(`${r.slug}: FARM with gas $${r.gas_usd} > ${PARAMS.farm_max_gas_usd}`);
      if (r.p_token < PARAMS.farm_min_p) bad.push(`${r.slug}: FARM with p_token ${r.p_token} < ${PARAMS.farm_min_p}`);
    } else if (r.verdict === 'WATCH') {
      if (nh >= t.q90 && r.gas_usd <= PARAMS.farm_max_gas_usd && r.p_token >= PARAMS.farm_min_p) bad.push(`${r.slug}: WATCH but passes FARM`);
      if (nh < t.q50) bad.push(`${r.slug}: WATCH below q50 ${t.q50}`);
    } else if (nh >= t.q50) bad.push(`${r.slug}: SKIP with net $/hr ${nh} >= q50 ${t.q50}`);
    if (r.verdict_reason !== reasonOf(nh, r.gas_usd, r.p_token, t)) bad.push(`${r.slug}: reason "${r.verdict_reason}" does not match the rule`);
  }
  return bad;
}

const pctText = (p: number): string => `${Math.round(p * 100)}%`;

export function buildRadar(snapshot: Snapshot): { board: Row[]; radar: RadarData } {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || bySlug(a, b))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const peers = peersOf(snapshot);
  const trained = train(peers);
  const pool = poolOf(snapshot);
  const integrity = validate(snapshot);

  const scored = [...chosen.values()].map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const cat = catKey(p.category);
    const odds = oddsFor(pool, { slug: p.slug, cat, tb: tvlBucket(p.tvl_usd), ab: ageBucket(age) });
    const v = valueOf(trained, cat, p.tvl_usd, p.change_7d, age);
    const steps = farmPlan(p, age);
    const cost = steps.reduce((a, s) => a + stepCost(s), 0);
    const minutes = steps.reduce((a, s) => a + s.minutes, 0);
    const hours = minutes / 60;
    const expRaw = odds.p * v.implied * PARAMS.capture;
    const exp50 = Math.min(expRaw, PARAMS.wallet_cap_usd);
    const exp10 = Math.min(odds.p * v.p10 * PARAMS.capture, PARAMS.wallet_cap_usd);
    const h = Math.max(hours, PARAMS.hours_floor);
    const gas = steps.reduce((a, s) => a + s.gas_usd, 0);
    const bridge = steps.reduce((a, s) => a + s.bridge_usd, 0);
    const deposits = steps.reduce((a, s) => a + s.deposit_usd, 0);
    const hr50 = exp50 / h;
    const hr10 = exp10 / h;
    const net50 = exp50 - gas;
    const net10 = exp10 - gas;
    const netHr50 = net50 / h;
    const netHr10 = net10 / h;
    return { p, age, odds, v, steps, cost, minutes, hours, expRaw, exp50, exp10, gas, bridge, deposits, hr50, hr10, net50, net10, netHr50, netHr10 };
  });
  // strict total order: implied value desc, slug asc (net $/hr stays a column and drives the verdict quantiles only)
  scored.sort((a, b) => b.v.implied - a.v.implied || bySlug(a.p, b.p));

  const th = thresholdsOf(scored.map((x) => r2(x.netHr50)));
  integrity.q50_net_per_hr = th.q50;
  integrity.q90_net_per_hr = th.q90;
  const board: Row[] = scored.map(({ p, age, odds, v, steps, cost, minutes, hours, expRaw, exp50, exp10, gas, bridge, deposits, hr50, hr10, net50, net10, netHr50, netHr10 }, i) => {
    const kind = kindOf(p.category);
    const gasR = r2(gas);
    const netHr50r = r2(netHr50);
    const costR = r2(cost);
    const verdict = verdictOf(netHr50r, gasR, odds.p, th);
    const verdict_reason = reasonOf(netHr50r, gasR, odds.p, th);
    const why =
      `p(token) ${pctText(odds.p)}, ${supportText(odds)}. ` +
      `Implied ${v.multiple.toFixed(2)}x TVL = category median ${v.category_median.toFixed(2)}x (${v.peer_n} peers) ` +
      `x growth ${v.growth_factor.toFixed(2)} x age ${v.age_factor.toFixed(2)}${v.clipped ? ', clipped' : ''}.`;
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      kind,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token' as const,
      watch: watch.has(p.slug),
      age_days: age,
      p_token: odds.p,
      peer_count: odds.n,
      peer_tokenised: odds.k,
      support_level: odds.level,
      support_text: supportText(odds),
      odds,
      implied_value_usd: v.implied,
      implied_p10_usd: v.p10,
      implied_p90_usd: v.p90,
      p10_clamped: v.p10_clamped,
      p90_clamped: v.p90_clamped,
      band_low_usd: v.p10,
      band_high_usd: v.p90,
      multiple: r4(v.multiple),
      value: {
        peer_key: v.peer_key,
        peer_n: v.peer_n,
        category_median: r4(v.category_median),
        growth_factor: r4(v.growth_factor),
        age_factor: r4(v.age_factor),
        raw_multiple: r4(v.raw_multiple),
        clipped: v.clipped,
        sigma: r4(v.sigma),
        sigma_eff: r4(v.sigma_eff),
        z: PARAMS.z_p90,
      },
      steps,
      farm_steps: steps.map(stepText),
      total_cost_usd: costR,
      total_hours: r2(hours),
      farm_total_cost_usd: costR,
      farm_total_minutes: minutes,
      capture: PARAMS.capture,
      wallet_cap_usd: PARAMS.wallet_cap_usd,
      expected_usd_raw: r2(expRaw),
      expected_usd: r2(exp50),
      expected_usd_p50: r2(exp50),
      expected_usd_p10: r2(exp10),
      capped: expRaw > PARAMS.wallet_cap_usd,
      gas_usd: gasR,
      bridge_usd: r2(bridge),
      capital_at_risk_usd: r2(deposits),
      usd_per_hr_p50: r2(hr50),
      usd_per_hr_p10: r2(hr10),
      net_usd_p50: r2(net50),
      net_usd_p10: r2(net10),
      net_per_hr_p50: netHr50r,
      net_per_hr_p10: r2(netHr10),
      verdict,
      verdict_reason,
      why,
      risk_note: `${RISK_NOTE[kind]} No token is announced: a points programme may never come.`,
    };
  });
  integrity.protocols_scored = board.length;
  for (const r of board) {
    integrity.verdict_counts[r.verdict]++;
    integrity.support_counts[r.support_level]++;
  }
  integrity.verdict_violations = verdictAudit(board).length;
  integrity.accounting = accountingOf(snapshot, board);
  integrity.kpis = kpisOf(snapshot, board, integrity);

  const keys = new Set(board.map((r) => r.value.peer_key));
  const peerSets: RadarData['peer_sets'] = {};
  for (const k of keys) {
    const members = peers.filter((q) => k === '*' || q.cat === k).sort((a, b) => b.tvl - a.tvl);
    const s = k === '*' ? trained.global : trained.cats.get(k)!;
    peerSets[k] = { n: members.length, median: r4(s.median), sigma: r4(s.sigma), members: members.map((q) => [q.name, Math.round(q.tvl), Math.round(q.mcap)]) };
  }
  const categories: Record<string, CatStat> = {};
  for (const [k, s] of [...trained.cats].sort((a, b) => b[1].n - a[1].n || (a[0] < b[0] ? -1 : 1))) {
    categories[k] = { n: s.n, median: r4(s.median), sigma: r4(s.sigma) };
  }
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source.replace(/https?:\/\/[^\s,]+/g, 'the protocols endpoint'),
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    params: PARAMS,
    integrity,
    fit: {
      b_growth: r4(trained.fit.b_growth),
      b_age: r4(trained.fit.b_age),
      mean_growth: r4(trained.fit.mean_growth),
      mean_age: r4(trained.fit.mean_age),
      n: trained.fit.n,
      r2: r4(trained.fit.r2),
    },
    categories,
    global: { n: trained.global.n, median: r4(trained.global.median), sigma: r4(trained.global.sigma) },
    peer_sets: peerSets,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watch).length,
    live_size: snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX').length,
    rows: board,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || !finite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: finite(p.change_7d) ? p.change_7d : null,
      mcap_usd: finite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why an integrity record is not acceptable, or null: the four numbers must be finite and real. */
export function integrityIssue(i: Integrity): string | null {
  for (const k of ['walk_forward_ratio', 'leave_one_out_ratio', 'brier_model', 'brier_base'] as const) {
    if (!finite(i[k]) || i[k] <= 0) return `integrity ${k} is ${i[k]}`;
  }
  if (i.walk_forward_test < 10 || i.peers_used < 30) return 'too few peers to validate';
  const { FARM, SKIP } = i.verdict_counts;
  if (FARM < 5 || FARM > 35) return `${FARM} FARM rows, want 5-35`;
  if (SKIP < 80) return `${SKIP} SKIP rows, want at least 80`;
  if (!(i.q90_net_per_hr > i.q50_net_per_hr)) return `q90 ${i.q90_net_per_hr} is not above q50 ${i.q50_net_per_hr}`;
  return null;
}

/** Why a board is not acceptable, or null: coverage, size, ranks, $/hr order, p10 and p50 figures, 3-6 costed steps. */
export function boardIssue(board: Row[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug(s): ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 150 || board.length > 260) return `${board.length} rows, want 150-260`;
  for (let i = 0; i < board.length; i++) if (board[i]!.rank !== i + 1) return `rank ${i + 1} is ${board[i]!.rank}`;
  for (let i = 1; i < board.length; i++) {
    const a = board[i - 1]!, b = board[i]!;
    if (b.implied_value_usd > a.implied_value_usd || (b.implied_value_usd === a.implied_value_usd && b.slug < a.slug)) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  const violations = verdictAudit(board);
  if (violations.length > 0) return `verdict rule violations: ${violations.slice(0, 3).join(' | ')}`;
  const seen = new Map<string, string>();
  for (const r of board) {
    if (![r.usd_per_hr_p50, r.usd_per_hr_p10, r.net_per_hr_p50, r.net_per_hr_p10, r.gas_usd, r.p_token, r.total_cost_usd, r.total_hours].every(finite)) return `${r.slug} has a missing figure`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_p10_usd <= 0 || r.implied_p10_usd > r.implied_value_usd) return `${r.slug} has implied value ${r.implied_p10_usd}..${r.implied_value_usd}`;
    if (r.usd_per_hr_p10 > r.usd_per_hr_p50 || r.net_per_hr_p10 > r.net_per_hr_p50) return `${r.slug} has p10 $/hr above p50`;
    if (r.implied_p10_usd < r.tvl_usd * PARAMS.implied_p10_floor - 1 || r.implied_p90_usd > r.tvl_usd * PARAMS.implied_p90_cap + 1) return `${r.slug} has an implied range outside 0.05x-20x TVL`;
    if (r.support_level !== 'global' && r.peer_tokenised < PARAMS.min_support) return `${r.slug} has ${r.peer_tokenised} tokenised peers behind a ${r.support_level} estimate`;
    if (r.support_level === 'global' && r.odds.global.k < PARAMS.min_support) return `${r.slug} has under ${PARAMS.min_support} tokenised peers even globally`;
    if (r.p_token < PARAMS.p_min - 1e-9 || r.p_token > PARAMS.p_max + 1e-9) return `${r.slug} p(token) ${r.p_token} is outside the clip`;
    if (r.steps.length < 3 || r.steps.length > 6 || r.farm_steps.length !== r.steps.length) return `${r.slug} has ${r.steps.length} farm steps`;
    for (const s of r.farm_steps) {
      if (s.length < 40 || s.length > 300) return `${r.slug} has a farm step of ${s.length} characters`;
      if (!/Cost: /.test(s) || !/Time: \d+ min/.test(s) || !/Risk: (Low|Medium|High)\./.test(s)) return `${r.slug} has a step without cost, time or risk`;
      const other = seen.get(s);
      if (other !== undefined && other !== r.slug) return `${r.slug} and ${other} share a farm step`;
      seen.set(s, r.slug);
    }
  }
  return null;
}

/** Groups of top-ten rows that share one value of `key`; empty when the top ten are all distinct. */
export function topTenTies(board: Row[], key: 'net_per_hr_p50' | 'usd_per_hr_p50'): string[][] {
  const by = new Map<number, string[]>();
  for (const r of board.slice(0, 10)) by.set(r[key], [...(by.get(r[key]) ?? []), r.slug]);
  return [...by.values()].filter((g) => g.length > 1);
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

// ---------------------------------------------------------------- header KPIs and protocol accounting

export interface Term { name: string; full: number | null; half1: number | null; half2: number | null; ok: boolean }
export interface Stability { k: number; n: number; terms: Term[]; split: string }
export interface Kpis {
  out_of_sample_miss: { ratio: number; ratio_of_medians: number; n: number; text: string };
  range_honesty: { inside: number; n: number; share: number; text: string };
  odds_vs_base: { model: string; model_brier: number; base_brier: number; n: number; stratified_brier: number; text: string };
  terms_survived: { value: Stability; odds: Stability; text: string };
  worth_farming: { farm: number; scored: number; net_usd_total: number; text: string };
  watchlist_ranked: { present: number; size: number; text: string };
}
export interface Accounting {
  total: number;
  groups: { key: string; label: string; count: number }[];
  groups_sum: number;
  rows_recomputed: number;
  rows: number;
  totals: { board_usd: number; rows_usd: number; recomputed_usd: number; equal: boolean; line: string };
}

const SURVIVE_TOL = 0.3;
const survives = (full: number | null, h: number | null): boolean =>
  full !== null && h !== null && Math.sign(h) === Math.sign(full) && full !== 0 && Math.abs(h - full) <= SURVIVE_TOL * Math.abs(full);
const byListed = <T extends { listed: string | null; slug: string }>(xs: T[]): T[] =>
  xs.filter((x) => x.listed !== null).sort((a, b) => (a.listed! < b.listed! ? -1 : a.listed! > b.listed! ? 1 : a.slug < b.slug ? -1 : 1));

/**
 * Coefficients that keep their sign and stay within 30% of the fitted magnitude when refit on the older and the newer
 * half (by listed_at) of the dated set. Value terms: the growth and age slopes (the category medians are group medians, not
 * coefficients, and most categories have under min_peers peers in a half, so they are not counted).
 * Odds terms: the validation-chosen logistic model's standardised weights, refit with the same category indicators.
 */
export function stabilityOf(snapshot: Snapshot, chosen: CalibName): { value: Stability; odds: Stability } {
  const peers = peersOf(snapshot);
  const prod = train(peers);
  const dated = byListed(peers);
  const mid = Math.floor(dated.length / 2);
  const halves = [train(dated.slice(0, mid)), train(dated.slice(mid))];
  const vt: Term[] = [];
  const mk = (name: string, full: number | null, a: number | null, b: number | null): Term => ({ name, full, half1: a, half2: b, ok: survives(full, a) && survives(full, b) });
  vt.push(mk('growth slope', prod.fit.b_growth, halves[0]!.fit.b_growth, halves[1]!.fit.b_growth));
  vt.push(mk('age slope', prod.fit.b_age, halves[0]!.fit.b_age, halves[1]!.fit.b_age));
  const pool = byListed(poolOf(snapshot));
  const pmid = Math.floor(pool.length / 2);
  const full = fitLogit(pool.map((e) => e.l), chosen);
  const f1 = fitLogit(pool.slice(0, pmid).map((e) => e.l), chosen, full.cats);
  const f2 = fitLogit(pool.slice(pmid).map((e) => e.l), chosen, full.cats);
  const ot: Term[] = full.w.map((w, j) => mk(full.features[j]!, w, f1.w[j] ?? null, f2.w[j] ?? null));
  const sv = (t: Term[], split: string): Stability => ({ k: t.filter((x) => x.ok).length, n: t.length, terms: t, split });
  return {
    value: sv(vt, `older/newer half of ${dated.length} dated tokenised peers (${mid} + ${dated.length - mid})`),
    odds: sv(ot, `older/newer half of ${pool.length} dated protocols (${pmid} + ${pool.length - pmid}), tokenised or not`),
  };
}

const NAME_WRAPPED = (n: string): boolean => /\b(wrapped|staked)\b/i.test(n) || /^(w|st|wst)[A-Z0-9]{2,}\b/.test(n) || /^WBTC\b/.test(n);

/** Mutually exclusive status of every snapshot protocol; first match wins, in this order. */
export const STATUS_ORDER: [string, string][] = [
  ['watchlist', 'ranked watchlist'],
  ['early', 'ranked early, below the floor'],
  ['token', 'already records a token'],
  ['lst', 'liquid staking'],
  ['cex', 'exchange custody'],
  ['wrapped', 'wrapped or staked'],
  ['versioned', 'versioned release'],
  ['other', 'other'],
];

export function statusOf(p: SnapshotProtocol, ranked: Map<string, boolean>): string {
  const r = ranked.get(p.slug);
  if (r !== undefined) return r ? 'watchlist' : 'early';
  if (!isPreToken(p)) return 'token';
  if (p.category === 'Liquid Staking') return 'lst';
  if (p.category === 'CEX') return 'cex';
  if (NAME_WRAPPED(p.name)) return 'wrapped';
  if (VERSIONED.test(p.name)) return 'versioned';
  return 'other';
}

/** Recomputes every row's implied value from the snapshot alone and totals it three ways; throws if they disagree. */
export function accountingOf(snapshot: Snapshot, board: Row[]): Accounting {
  const trained = train(peersOf(snapshot));
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  let recomputed = 0, recomputedUsd = 0;
  for (const r of board) {
    const p = index.get(r.slug)!;
    const v = valueOf(trained, catKey(p.category), p.tvl_usd, p.change_7d, ageDays(snapshot.as_of, p.listed_at));
    recomputedUsd += v.implied;
    if (v.implied === r.implied_value_usd && v.p10 === r.implied_p10_usd && v.p90 === r.implied_p90_usd) recomputed++;
  }
  const ranked = new Map(board.map((r) => [r.slug, r.watch] as const));
  const counts = new Map(STATUS_ORDER.map(([k]) => [k, 0]));
  for (const p of snapshot.protocols) counts.set(statusOf(p, ranked), counts.get(statusOf(p, ranked))! + 1);
  const groups = STATUS_ORDER.map(([key, label]) => ({ key, label, count: counts.get(key)! }));
  const groupsSum = groups.reduce((s, g) => s + g.count, 0);
  if (groupsSum !== snapshot.protocols.length) throw new Error(`accounting: groups sum to ${groupsSum}, snapshot has ${snapshot.protocols.length}`);
  const boardUsd = board.filter((r) => r.watch).reduce((s, r) => s + r.implied_value_usd, 0) + board.filter((r) => !r.watch).reduce((s, r) => s + r.implied_value_usd, 0);
  const rowsUsd = board.reduce((s, r) => s + r.implied_value_usd, 0);
  const equal = boardUsd === rowsUsd && rowsUsd === recomputedUsd;
  if (!equal) throw new Error(`accounting: totals disagree: watchlist+early ${boardUsd}, rows ${rowsUsd}, recomputed ${recomputedUsd}`);
  if (recomputed !== board.length) throw new Error(`accounting: only ${recomputed} of ${board.length} rows recompute`);
  const money0 = (n: number): string => '$' + n.toLocaleString('en-US');
  return {
    total: snapshot.protocols.length,
    groups,
    groups_sum: groupsSum,
    rows_recomputed: recomputed,
    rows: board.length,
    totals: {
      board_usd: boardUsd,
      rows_usd: rowsUsd,
      recomputed_usd: recomputedUsd,
      equal,
      line: `Implied value across the board ${money0(boardUsd)} = sum over ${board.length} rows ${money0(rowsUsd)} = sum recomputed from the snapshot ${money0(recomputedUsd)}: equal`,
    },
  };
}

export function kpisOf(snapshot: Snapshot, board: Row[], i: Integrity): Kpis {
  const st = stabilityOf(snapshot, i.calib_model);
  const slugs = new Set(board.map((r) => r.slug));
  const present = snapshot.watchlist.filter((s) => slugs.has(s)).length;
  const farm = board.filter((r) => r.verdict === 'FARM');
  const net = r2(farm.reduce((s, r) => s + r.net_usd_p50, 0));
  const share = i.wf_inside / i.wf_n;
  return {
    out_of_sample_miss: { ratio: i.wf_median_ratio, ratio_of_medians: i.wf_ratio_of_medians, n: i.wf_n, text: `x${i.wf_median_ratio.toFixed(2)}` },
    range_honesty: { inside: i.wf_inside, n: i.wf_n, share: r4(share), text: `${Math.round(share * 100)}%` },
    odds_vs_base: { model: i.calib_model, model_brier: i.calib_test_brier, base_brier: i.calib_base_test, n: i.calib_n, stratified_brier: i.brier_stratified_test, text: `${i.calib_test_brier.toFixed(3)} vs ${i.calib_base_test.toFixed(3)}` },
    terms_survived: { value: st.value, odds: st.odds, text: `${st.value.k} of ${st.value.n} value · ${st.odds.k} of ${st.odds.n} odds` },
    worth_farming: { farm: farm.length, scored: board.length, net_usd_total: net, text: `${farm.length} of ${board.length}` },
    watchlist_ranked: { present, size: snapshot.watchlist.length, text: `${present}/${snapshot.watchlist.length}` },
  };
}
