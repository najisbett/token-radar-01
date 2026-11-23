// Token radar model: one snapshot in, one ranked board out. Standard library only.
//
// Implied value comes only from the snapshot's own figures, through one function that scores every row
// the same way (no protocol is ever named in the model):
//
//   implied = TVL x category x growth x age x thin
//
//   category  multiplier from CATEGORY_MULTIPLIER, keyed by the snapshot's category label (CDP 1.35 ... Bridge 0.8,
//             unlisted labels 1.0); the dashboard legend is rendered from the same table
//   growth    clamp( (1 + r)^(90/7) ^ 0.2 , 0.6, 1.6 ) with r = change_7d / 100 clamped to [-50%, +100%]:
//             the 7-day rate compounded into a 90-day outlook, then damped by a fifth-root
//   age       0.7 + 0.5 x min(days listed, 1095) / 1095: a protocol that has run longer with no token scores
//             higher (0.7 on day one, 1.2 from three years); unknown listing date counts as one year
//   readiness 0-100 (not a factor): 40 age + 30 growth persistence + 30 TVL durability, see readiness()
//   thin      0.85 when TVL < $5M, else 1
//
// The result is rounded, clamped to at least 1, and the board is sorted descending. The confidence band is
// implied x (1 -/+ w), where w grows with a young listing, thin TVL, a missing date and an extreme week.

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

export const MODEL_VERSION = 'radar-3';
export const EARLY_ROWS = 160;

export const PARAMS = {
  outlook_days: 90,
  growth_period_days: 7,
  growth_damping: 0.2,
  growth_rate_min: -0.5,
  growth_rate_max: 1,
  growth_min: 0.6,
  growth_max: 1.6,
  age_floor: 0.7,
  age_range: 0.5,
  age_saturation_days: 1095,
  age_unknown_days: 365,
  thin_tvl_usd: 5_000_000,
  thin_discount: 0.85,
};

export type Kind = 'lending' | 'dex' | 'perp' | 'bridge' | 'restaking' | 'yield' | 'chain';

/** One table drives scoring, the board's category factor and the dashboard legend. Keys are the snapshot's own
 *  category labels; anything not listed (or uncategorised) gets CATEGORY_DEFAULT. */
export const CATEGORY_MULTIPLIER: Readonly<Record<string, number>> = {
  Perp: 1.6,
  Restaking: 1.4,
  CDP: 1.35,
  Lending: 1.3,
  'Collateral Markets': 1.2,
  Dexs: 1.2,
  Chain: 1.2,
  'Risk Curators': 1.15,
  'Onchain Capital Allocator': 1.15,
  RWA: 1.1,
  Yield: 1.0,
  Bridge: 0.8,
};
export const CATEGORY_DEFAULT = 1.0;

export function categoryMultiplier(category: string | null): number {
  return category !== null && Object.hasOwn(CATEGORY_MULTIPLIER, category) ? CATEGORY_MULTIPLIER[category]! : CATEGORY_DEFAULT;
}

export interface Step {
  action: string;
  capital_usd: number;
  gas_usd: number;
  minutes: number;
  risk?: Risk;
}

export type Risk = 'Low' | 'Med' | 'High';

/** Launch readiness, 0-100: how settled the protocol looks while it still has no token. */
export interface Readiness {
  score: number;
  /** Points out of 40: time listed with no token (saturates at three years; unknown date counts a third). */
  age_pts: number;
  /** Points out of 30: does the 7-day move look like steady growth (mild rise) rather than a spike or a bleed. */
  persistence_pts: number;
  /** Points out of 30: TVL durability, log-scaled from $100K (0) to $1B (30). */
  durability_pts: number;
}

export interface Factors {
  category: number;
  growth: number;
  age: number;
  thin: number;
}

export interface BoardRow {
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
  age_days: number | null;
  implied_value_usd: number;
  band_low_usd: number;
  band_high_usd: number;
  confidence_pct: number;
  model: {
    category_multiplier: number;
    growth_multiplier: number;
    age_multiplier: number;
    thin_tvl_multiplier: number;
    growth_pct: number | null;
    outlook_90d_pct: number;
    age_days: number | null;
    age_known: boolean;
  };
  readiness: Readiness;
  /** implied value / TVL */
  multiple: number;
  why: string;
  risk_note: string;
  farm_steps: string[];
  farm_total_cost_usd: number;
  farm_total_minutes: number;
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  kind: Kind;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  age_known: boolean;
  implied_value_usd: number;
  band_low_usd: number;
  band_high_usd: number;
  confidence_pct: number;
  band_pct: number;
  band_low_pct_usd: number;
  band_high_pct_usd: number;
  watch: boolean;
  f: Factors;
  outlook_90d_pct: number;
  readiness: Readiness;
  multiple: number;
  driver: keyof Factors;
  drag: keyof Factors;
  why: string;
  risk_note: string;
  steps: Step[];
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  params: typeof PARAMS;
  /** Multiplier of every category that appears on the board (the same table the scorer used). */
  category_multiplier: Record<string, number>;
  category_default: number;
  watchlist_size: number;
  median_multiple: number;
  growing_share_pct: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

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

/** Launch readiness from three snapshot figures: age since listed_at, 7d growth persistence, TVL durability. */
export function readiness(p: SnapshotProtocol, age: number | null): Readiness {
  const ageShare = age === null ? 1 / 3 : Math.min(age, PARAMS.age_saturation_days) / PARAMS.age_saturation_days;
  const g = finite(p.change_7d) ? p.change_7d / 100 : null;
  // A mild rise is the most persistent; a spike above +50% or a fall of 20% or more is not.
  let persistence = 0.4;
  if (g !== null) {
    if (g >= 0 && g <= 0.5) persistence = 0.65 + 0.35 * (1 - Math.abs(g - 0.05) / 0.45);
    else if (g > 0.5) persistence = Math.max(0.2, 0.65 - (g - 0.5) * 0.5);
    else persistence = Math.max(0, 0.6 + g * 3);
  }
  const tvl = finite(p.tvl_usd) && p.tvl_usd > 0 ? p.tvl_usd : 0;
  const durability = tvl <= 0 ? 0 : clamp(Math.log10(tvl / 1e5) / 4, 0, 1);
  const age_pts = Math.round(40 * ageShare);
  const persistence_pts = Math.round(30 * clamp(persistence, 0, 1));
  const durability_pts = Math.round(30 * durability);
  return { score: age_pts + persistence_pts + durability_pts, age_pts, persistence_pts, durability_pts };
}

const FACTOR_NAME: Record<keyof Factors, string> = { category: 'category', growth: '7d growth', age: 'time with no token', thin: 'thin TVL' };

/** One line: the factor that lifts the value most, and the one that holds it back most. */
export function whyLine(f: Factors, p: SnapshotProtocol, age: number | null): { driver: keyof Factors; drag: keyof Factors; why: string } {
  const keys = ['category', 'growth', 'age', 'thin'] as (keyof Factors)[];
  const sorted = [...keys].sort((a, b) => Math.log(f[b]) - Math.log(f[a]));
  const driver = sorted[0]!;
  const drag = sorted[sorted.length - 1]!;
  const detail = (k: keyof Factors): string => {
    if (k === 'category') return p.category ?? 'no category';
    if (k === 'growth') return finite(p.change_7d) ? `${p.change_7d > 0 ? '+' : ''}${p.change_7d.toFixed(1)}% in 7d` : 'no 7d figure';
    if (k === 'age') return age === null ? 'listing date unknown' : age >= 365 ? `${(age / 365).toFixed(1)} y listed` : `${age} d listed`;
    return f.thin < 1 ? 'TVL under $5M' : 'TVL above $5M';
  };
  const x = (k: keyof Factors): string => `${FACTOR_NAME[k]} ×${f[k].toFixed(2)} (${detail(k)})`;
  const tail = f[drag] < 1 ? `held back by ${x(drag)}` : `no drag, weakest is ${x(drag)}`;
  return { driver, drag, why: `Lifted by ${x(driver)}; ${tail}.` };
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

export function riskNote(kind: Kind, r: Readiness, p: SnapshotProtocol): string {
  const extra: string[] = [];
  if (p.tvl_usd < PARAMS.thin_tvl_usd) extra.push('TVL is thin, so one large exit moves the pool.');
  if (r.score < 40) extra.push('Readiness is low: young or volatile.');
  extra.push('No token is announced: a points programme may never come.');
  return `${RISK_NOTE[kind]} ${extra.slice(0, 2).join(' ')}`;
}

const HIGH_RISK = /borrow|short|long |leverag|riskier|slash|unbond|lock |stop on|impermanent/i;
export function stepRisk(s: Step): Risk {
  if (s.capital_usd === 0 && s.gas_usd === 0) return 'Low';
  if (HIGH_RISK.test(s.action) && (s.capital_usd > 0 || s.gas_usd > 0)) return 'High';
  if (s.capital_usd > 0 || /deploy|repay|withdraw|remove|rebalance|vote/i.test(s.action)) return 'Med';
  return 'Low';
}

/** The four factors and the implied value of one protocol. Always a positive integer. */
export function score(p: SnapshotProtocol, asOf: string) {
  const age = ageDays(asOf, p.listed_at);
  const category = categoryMultiplier(p.category);

  const r = clamp((finite(p.change_7d) ? p.change_7d : 0) / 100, PARAMS.growth_rate_min, PARAMS.growth_rate_max);
  const compounded = Math.pow(1 + r, PARAMS.outlook_days / PARAMS.growth_period_days);
  const growth = clamp(Math.pow(compounded, PARAMS.growth_damping), PARAMS.growth_min, PARAMS.growth_max);

  const years = Math.min(age ?? PARAMS.age_unknown_days, PARAMS.age_saturation_days) / PARAMS.age_saturation_days;
  const ageF = PARAMS.age_floor + PARAMS.age_range * years;

  const tvl = finite(p.tvl_usd) && p.tvl_usd > 0 ? p.tvl_usd : 0;
  const thin = tvl < PARAMS.thin_tvl_usd ? PARAMS.thin_discount : 1;

  const raw = tvl * category * growth * ageF * thin;
  const implied = Number.isFinite(raw) ? Math.max(1, Math.round(raw)) : 1;

  let w = 0.25;
  if (age === null) w += 0.1;
  else if (age < 180) w += 0.12;
  if (thin < 1) w += 0.08;
  if (Math.abs(r) > 0.25) w += 0.1;
  w = Math.min(w, 0.6);
  return {
    age,
    factors: { category, growth, age: ageF, thin },
    implied,
    outlook: (compounded - 1) * 100,
    low: Math.max(1, Math.round(implied * (1 - w))),
    high: Math.max(1, Math.round(implied * (1 + w))),
    confidence: Math.round((1 - w) * 100),
    readiness: readiness(p, age),
    multiple: tvl > 0 ? implied / tvl : 0,
  };
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
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
  if (chain === 'Solana' || chain === 'Sui' || chain === 'Aptos' || chain === 'TON') return 0.05;
  return 0.8;
}

function capitalFor(tvl: number): number {
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
}

type Template = (c: Ctx) => Step;
const st = (action: string, capital: number, txs: number, c: Ctx, minutes: number): Step => ({
  action,
  capital_usd: capital,
  gas_usd: Math.round(txs * c.gas * 100) / 100,
  minutes,
});

const PLANS: Record<Kind, { base: number; steps: Template[] }> = {
  lending: {
    base: 6,
    steps: [
      (c) => st(`Open a fresh wallet on ${c.chain}, then supply USDC to the main market on ${c.n}.`, c.cap, 2, c, 15),
      (c) => st(`Borrow a different stablecoin on ${c.n}, keeping the loan under 40% of collateral.`, 0, 1, c, 8),
      (c) => st(`Repay the loan on ${c.n} and re-supply, once a week for ${c.weeks} weeks.`, 0, 2 * c.weeks, c, 10 * c.weeks),
      (c) => st(`Check ${c.n}'s health factor twice a week; add collateral if it drops below 1.8.`, 0, 1, c, 4 * c.weeks),
      (c) => st(`Read ${c.n}'s docs and official posts for any points or rewards page; claim only from its own link.`, 0, 0, c, 20),
      (c) => st(`Withdraw and close the ${c.n} position after day ${c.hold}, then log the hashes.`, 0, 3, c, 12),
      (c) => st(`Split the supply across a second ${c.n} market so activity shows in more than one pool.`, c.half, 2, c, 12),
      (c) => st(`Vote on or read one ${c.n} governance proposal; it is free and shows engagement.`, 0, 1, c, 15),
    ],
  },
  dex: {
    base: 5,
    steps: [
      (c) => st(`Swap USDC for the paired asset on ${c.n} (${c.chain}); keep price impact under 0.3%.`, c.half, 2, c, 10),
      (c) => st(`Deposit both sides into ${c.n}'s highest-volume pool and keep the LP token.`, c.cap, 3, c, 12),
      (c) => st(`Trade once a week in both directions on ${c.n} for ${c.weeks} weeks to build volume.`, 0, 2 * c.weeks, c, 6 * c.weeks),
      (c) => st(`Check impermanent loss on ${c.n}; rebalance if the pair drifts over 10% from entry.`, 0, 2, c, 10),
      (c) => st(`Remove the liquidity from ${c.n} after day ${c.hold} and swap back to USDC.`, 0, 3, c, 10),
      (c) => st(`Lock or stake the LP token on ${c.n} if a lock under ${c.hold} days exists.`, 0, 2, c, 8),
      (c) => st(`Read ${c.n}'s official channel for any points rules; never sign a claim from a DM.`, 0, 0, c, 15),
    ],
  },
  perp: {
    base: 5,
    steps: [
      (c) => st(`Deposit USDC as margin on ${c.n} (${c.chain}); keep at least 60% of it idle.`, c.cap, 2, c, 12),
      (c) => st(`Open a small long on ${c.n} at 2x or less, then close it within a day.`, c.half, 2, c, 8),
      (c) => st(`Place an opposite short on ${c.n} once a week for ${c.weeks} weeks, never above 3x.`, 0, 2 * c.weeks, c, 8 * c.weeks),
      (c) => st(`Check ${c.n}'s volume tiers and keep monthly volume just above the first threshold.`, 0, 0, c, 10),
      (c) => st(`Withdraw the margin from ${c.n} after day ${c.hold} and note fees and funding paid.`, 0, 2, c, 10),
      (c) => st(`Try one limit order and one stop on ${c.n} so the account shows more than market orders.`, 0, 2, c, 10),
      (c) => st(`Read ${c.n}'s points or rewards rules from its own site and note the cutoff date.`, 0, 0, c, 15),
    ],
  },
  bridge: {
    base: 4,
    steps: [
      (c) => st(`Send a $5 test transfer through ${c.n} to ${c.chain} and wait for it to land.`, 5, 1, c, 15),
      (c) => st(`Bridge USDC through ${c.n} into ${c.chain} and use it in one app there.`, c.cap, 2, c, 20),
      (c) => st(`Bridge a smaller amount back out through ${c.n} after two weeks.`, c.half, 1, c, 20),
      (c) => st(`Compare ${c.n}'s fee and time with one rival route before each transfer.`, 0, 0, c, 10),
      (c) => st(`Repeat one ${c.n} transfer monthly for ${Math.ceil(c.hold / 30)} months to show steady use.`, c.half, 2, c, 20),
      (c) => st(`Keep every ${c.n} receipt page; a hash and timestamp make a stuck transfer recoverable.`, 0, 0, c, 5),
    ],
  },
  restaking: {
    base: 5,
    steps: [
      (c) => st(`Stake the native asset through ${c.n} on ${c.chain} and confirm the receipt token arrives.`, c.cap, 2, c, 15),
      (c) => st(`Delegate the ${c.n} position to an operator with a clean slashing record.`, 0, 1, c, 10),
      (c) => st(`Put the receipt token into one integration that ${c.n} lists, if its exit queue is under ${c.hold} days.`, 0, 2, c, 15),
      (c) => st(`Note ${c.n}'s unbonding period and plan the exit request before day ${c.hold}.`, 0, 0, c, 8),
      (c) => st(`Check ${c.n}'s dashboard weekly for reward rate changes for ${c.weeks} weeks.`, 0, 0, c, 3 * c.weeks),
      (c) => st(`Request the ${c.n} withdrawal near day ${c.hold} and collect after the queue clears.`, 0, 2, c, 12),
      (c) => st(`Split the stake across two ${c.n} operators to avoid one slashing event.`, c.half, 2, c, 12),
    ],
  },
  yield: {
    base: 4,
    steps: [
      (c) => st(`Deposit USDC into the largest vault on ${c.n} (${c.chain}) and confirm the share token.`, c.cap, 2, c, 12),
      (c) => st(`Read ${c.n}'s docs for deposit and withdrawal fees and any lock-up.`, 0, 0, c, 15),
      (c) => st(`Add to or rebalance the ${c.n} position once a week for ${c.weeks} weeks.`, 0, c.weeks, c, 5 * c.weeks),
      (c) => st(`Move a small slice into a second, riskier ${c.n} vault only after two weeks.`, c.half, 2, c, 10),
      (c) => st(`Claim ${c.n}'s earned yield at most once a week; each claim costs gas.`, 0, 1, c, 5),
      (c) => st(`Withdraw from ${c.n} after day ${c.hold} and note the realised yield.`, 0, 2, c, 10),
    ],
  },
  chain: {
    base: 6,
    steps: [
      (c) => st(`Bridge ETH or USDC to ${c.n} (${c.chain}) from an exchange or a major bridge.`, c.cap, 2, c, 20),
      (c) => st(`Swap on one ${c.n} app each week for ${c.weeks} weeks.`, 0, c.weeks, c, 5 * c.weeks),
      (c) => st(`Make a lending deposit on ${c.n}'s largest market to show a second kind of use.`, c.half, 2, c, 12),
      (c) => st(`Mint a name or NFT on ${c.n} as a cheap proof of activity.`, 0, 1, c, 8),
      (c) => st(`Deploy or call one contract on ${c.n} weekly for ${c.hold} days.`, 0, c.weeks, c, 10 * c.weeks),
      (c) => st(`Follow ${c.n}'s official channels; airdrop guides appear there first.`, 0, 0, c, 10),
      (c) => st(`Keep a small gas balance on ${c.n} so the wallet can always transact.`, 5, 1, c, 5),
      (c) => st(`Bridge the rest back out of ${c.n} after day ${c.hold}.`, 0, 2, c, 20),
    ],
  },
};

const fmt = (n: number): string => (n >= 10 ? String(Math.round(n)) : String(Math.round(n * 100) / 100));

/** One step as the board prints it: action, cost and time. */
export function stepText(s: Step): string {
  const cost =
    s.capital_usd > 0
      ? `$${fmt(s.capital_usd)} deposit (returned) + ~$${fmt(s.gas_usd)} gas`
      : s.gas_usd > 0
        ? `gas only, ~$${fmt(s.gas_usd)}`
        : '$0, no transaction';
  return `${s.action} Cost: ${cost}. Time: ${s.minutes} min.`;
}

export function farmPlan(p: SnapshotProtocol, age: number | null): Step[] {
  const chain = chainOf(p);
  const hold = holdFor(age);
  const cap = capitalFor(p.tvl_usd);
  const ctx: Ctx = { n: shortName(p), chain, cap, half: Math.round(cap / 2), hold, weeks: Math.ceil(hold / 7), gas: gasFor(chain) };
  const plan = PLANS[kindOf(p.category)];
  const extra = (p.tvl_usd >= 1e8 ? 1 : 0) + (age !== null && age < 180 ? 1 : 0);
  const count = Math.min(8, plan.steps.length, plan.base + extra);
  return plan.steps.slice(0, count).map((t) => {
    const s = t(ctx);
    // Keep every printed step inside 40..300 characters.
    while (stepText(s).length > 300 && s.action.length > 60) s.action = `${s.action.slice(0, s.action.length - 12).trimEnd()}…`;
    return s;
  });
}

// ---------------------------------------------------------------- the board

const bySlugOrder = (a: { slug: string }, b: { slug: string }): number => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);

export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || bySlugOrder(a, b))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, s: score(p, snapshot.as_of) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || bySlugOrder(a.p, b.p));
  return scored.map(({ p, s }, i) => {
    const steps = farmPlan(p, s.age);
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      kind: kindOf(p.category),
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token' as const,
      age_days: s.age,
      implied_value_usd: s.implied,
      band_low_usd: s.low,
      band_high_usd: s.high,
      confidence_pct: s.confidence,
      model: {
        category_multiplier: round4(s.factors.category),
        growth_multiplier: round4(s.factors.growth),
        age_multiplier: round4(s.factors.age),
        thin_tvl_multiplier: round4(s.factors.thin),
        growth_pct: finite(p.change_7d) ? p.change_7d : null,
        outlook_90d_pct: Math.round(clamp(s.outlook, -100, 1e9) * 10) / 10,
        age_days: s.age,
        age_known: s.age !== null,
      },
      readiness: s.readiness,
      multiple: Math.round(s.multiple * 1e3) / 1e3,
      ...(() => { const w = whyLine(s.factors, p, s.age); return { why: w.why, risk_note: riskNote(kindOf(p.category), s.readiness, p) }; })(),
      farm_steps: steps.map(stepText),
      farm_total_cost_usd: Math.round(steps.reduce((a, x) => a + x.capital_usd + x.gas_usd, 0)),
      farm_total_minutes: steps.reduce((a, x) => a + x.minutes, 0),
    };
  });
}

/** Display band for the chip: +/-15% when TVL is under the thin line, else +/-8%. */
export function bandPct(tvl: number): number {
  return tvl < PARAMS.thin_tvl_usd ? 15 : 8;
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const watch = new Set(snapshot.watchlist);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const rows: RadarRow[] = board.map((r) => ({
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    category: r.category,
    kind: r.kind,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    listed_at: r.listed_at,
    age_days: r.age_days,
    age_known: r.model.age_known,
    implied_value_usd: r.implied_value_usd,
    band_low_usd: r.band_low_usd,
    band_high_usd: r.band_high_usd,
    confidence_pct: r.confidence_pct,
    band_pct: bandPct(r.tvl_usd),
    band_low_pct_usd: Math.max(1, Math.round(r.implied_value_usd * (1 - bandPct(r.tvl_usd) / 100))),
    band_high_pct_usd: Math.round(r.implied_value_usd * (1 + bandPct(r.tvl_usd) / 100)),
    watch: watch.has(r.slug),
    f: {
      category: r.model.category_multiplier,
      growth: r.model.growth_multiplier,
      age: r.model.age_multiplier,
      thin: r.model.thin_tvl_multiplier,
    },
    outlook_90d_pct: r.model.outlook_90d_pct,
    readiness: r.readiness,
    multiple: r.multiple,
    ...(() => {
      const p = index.get(r.slug)!;
      const w = whyLine({ category: r.model.category_multiplier, growth: r.model.growth_multiplier, age: r.model.age_multiplier, thin: r.model.thin_tvl_multiplier }, p, r.age_days);
      return { driver: w.driver, drag: w.drag };
    })(),
    why: r.why,
    risk_note: r.risk_note,
    steps: farmPlan(index.get(r.slug)!, r.age_days).map((st) => ({ ...st, risk: stepRisk(st) })),
  }));
  const sortedM = rows.map((x) => x.multiple).sort((a, b) => a - b);
  const mid = sortedM.length >> 1;
  const median = sortedM.length === 0 ? 0 : sortedM.length % 2 ? sortedM[mid]! : (sortedM[mid - 1]! + sortedM[mid]!) / 2;
  const growing = rows.filter((x) => x.change_7d !== null && x.change_7d > 0).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source.replace(/https?:\/\/[^\s,]+/g, 'the protocols endpoint'),
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    params: PARAMS,
    category_multiplier: Object.fromEntries(
      [...new Set(rows.map((r) => r.category).filter((c): c is string => c !== null))]
        .sort((a, b) => a.localeCompare(b))
        .map((c) => [c, categoryMultiplier(c)]),
    ),
    category_default: CATEGORY_DEFAULT,
    watchlist_size: snapshot.watchlist.length,
    median_multiple: Math.round(median * 1e3) / 1e3,
    growing_share_pct: rows.length ? Math.round((growing / rows.length) * 1000) / 10 : 0,
    board_size: board.length,
    early_size: board.filter((r) => !watch.has(r.slug)).length,
    live_size: snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX').length,
    rows,
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

/** Why a board is not acceptable, or null: coverage, ranks, order, positive values, 3-8 steps with cost and time. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug(s): ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `only ${board.length} rows`;
  for (let i = 0; i < board.length; i++) if (board[i]!.rank !== i + 1) return `rank ${i + 1} is ${board[i]!.rank}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i}`;
  if (board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row has the same implied value';
  const seen = new Map<string, string>();
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 8) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      if (s.length < 40 || s.length > 300) return `${r.slug} has a farm step of ${s.length} characters`;
      if (!/Cost: /.test(s) || !/Time: \d+ min/.test(s)) return `${r.slug} has a step without cost or time`;
      const other = seen.get(s);
      if (other !== undefined && other !== r.slug) return `${r.slug} and ${other} share a farm step`;
      seen.set(s, r.slug);
    }
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
