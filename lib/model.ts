// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and may add
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board.
//
// Implied value follows only from the snapshot's own figures:
//
//   value      = tvl_usd x BASE_MULTIPLE + cashflow x CASHFLOW_MULTIPLE
//                (cashflow = revenue_usd if present, else fees_usd x FEE_TAKE_RATE, else 0)
//   growthMult = 1 + (clamp(change_7d, -60, 120) / 100) x GROWTH_WEIGHT        (trend; absent: 1)
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4                         (age unknown: 365 days)
//   chainW     = mean weight of the protocol's chains (unlisted chain: 1)
//   categoryM  = multiplier of the protocol's category kind (unknown: 1)
//   thin       = 0.9 when tvl_usd < THIN_TVL_USD, else 1                        (10% uncertainty discount)
//   implied    = max(1, round(value x growthMult x maturity x chainW x categoryM x thin))
//
// Any non-finite intermediate falls back to 1, so the result is always a positive integer.
// The constants are the house model's, stated in the dashboard and changeable in the model sandbox. No
// protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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
  /** Annualised protocol revenue in USD, when the snapshot carries it. */
  revenue_usd?: number | null;
  /** Annualised fees paid by users in USD, when the snapshot carries it. */
  fees_usd?: number | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  cashflow_multiple: number;
  fee_take_rate: number;
  thin_tvl_usd: number;
  thin_discount: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  cashflow_multiple: 10,
  fee_take_rate: 0.1,
  thin_tvl_usd: 5_000_000,
  thin_discount: 0.9,
};

/** The kinds of protocol the model prices and plans for. */
export type Kind = 'lending' | 'dex' | 'perp' | 'bridge' | 'restaking' | 'yield' | 'chain';

/** Category multiplier by kind: how the market has priced each business, relative to a plain yield vault. */
export const CATEGORY_MULTIPLIER: Record<Kind, number> = {
  perp: 1.3,
  restaking: 1.25,
  lending: 1.2,
  chain: 1.15,
  dex: 1.1,
  yield: 1.0,
  bridge: 0.85,
};

/** Chain weight: deeper, more active ecosystems carry a premium; a chain not listed weighs 1. */
export const CHAIN_WEIGHT: Record<string, number> = {
  Ethereum: 1.15,
  Solana: 1.1,
  Base: 1.05,
  Arbitrum: 1.05,
  Hyperliquid: 1.05,
  BSC: 1.0,
  Optimism: 1.0,
  Polygon: 0.95,
  Avalanche: 0.95,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-1';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    category_multiplier: number;
    thin_tvl_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  category_multiplier: number;
  thin_tvl_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The kind a category belongs to; anything unrecognised is priced and planned as a yield protocol. */
export function kindOf(category: string | null): Kind {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('borrow')) return 'lending';
  if (c.includes('perp') || c.includes('derivative') || c.includes('option')) return 'perp';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('restak') || c.includes('staking')) return 'restaking';
  if (c.includes('dex') || c.includes('amm') || c.includes('swap')) return 'dex';
  if (c === 'chain') return 'chain';
  return 'yield';
}

/** A non-negative finite number, else 0. */
function nonNeg(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** The mean weight of a protocol's chains; 1 when it names none. */
function chainWeight(chains: string[]): number {
  if (chains.length === 0) return 1;
  let sum = 0;
  for (const c of chains) sum += CHAIN_WEIGHT[c] ?? 1;
  return sum / chains.length;
}

/** The multipliers and the implied value one protocol gets under `model`; always a positive integer. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): { implied: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; categoryMult: number; thinMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const tvl = nonNeg(protocol.tvl_usd);
  const revenue = nonNeg(protocol.revenue_usd);
  const cashflow = revenue > 0 ? revenue : nonNeg(protocol.fees_usd) * model.fee_take_rate;
  const value = tvl * model.base_multiple + cashflow * model.cashflow_multiple;
  const chainMult = chainWeight(protocol.chains);
  const categoryMult = CATEGORY_MULTIPLIER[kindOf(protocol.category)];
  const thinMult = tvl < model.thin_tvl_usd ? model.thin_discount : 1;
  const raw = value * growthMult * maturityMult * chainMult * categoryMult * thinMult;
  const implied = Number.isFinite(raw) ? Math.max(1, Math.round(raw)) : 1;
  return { implied, growthPct, growthMult, maturityMult, chainMult, categoryMult, thinMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      category_multiplier: round4(s.categoryMult),
      thin_tvl_multiplier: round4(s.thinMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

const STEP_MIN = 40;
const STEP_MAX = 300;

/** A protocol name short enough to leave room in a step; a cut name keeps its slug so it stays unique. */
function shortName(p: SnapshotProtocol): string {
  if (p.name.length <= 32) return p.name;
  return `${p.name.slice(0, 20)}… [${p.slug.slice(0, 24)}]`;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  const c = p.chains[0];
  return c !== undefined && c.length <= 30 ? c : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Fit one step into 40..300 characters; a short one is padded with the protocol's slug, a long one cut. */
function fit(text: string, p: SnapshotProtocol): string {
  let s = text.replace(/\s+/g, ' ').trim();
  if (s.length < STEP_MIN) s = `${s} (${p.slug})`;
  if (s.length > STEP_MAX) s = `${s.slice(0, STEP_MAX - 1)}…`;
  return s;
}

/**
 * A protocol's farm plan: four to six concrete steps, 40..300 characters each, written for its kind
 * (lending, dex, perp, bridge, restaking, yield, chain) from its own name, chain, TVL and age. Every step
 * names the protocol, and the first also carries its slug, so no two protocols share a step.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const n = shortName(p);
  const chain = chainOf(p);
  const cap = capitalFor(p);
  const half = Math.round(cap / 2);
  const hold = holdDaysFor(age);
  const gas = cap >= 150 ? 8 : 4;
  const setup = `Create a fresh wallet for ${n} (${p.slug}), keep the seed offline and fund it with about $${cap + gas * 3} on ${chain}: the position plus gas.`;
  const log = `Log each ${n} transaction with its date and hash in a sheet, so you can repeat the position or unwind it if the rules change.`;
  const claim = `Before withdrawing from ${n}, open its own points or rewards page and claim only from the link it publishes; never pay to claim.`;
  let body: string[];
  switch (kindOf(p.category)) {
    case 'lending':
      body = [
        `Supply $${cap} of USDC to the main market on ${n} (${chain}); the receipt token should appear in your wallet within one transaction.`,
        `Borrow about $${half} of a different stablecoin against it on ${n}, keeping the loan under 40% of your collateral value.`,
        `Repay and re-supply on ${n} once a week for ${Math.ceil(hold / 7)} weeks so each snapshot sees supply, borrow and repay activity.`,
        `Check the health factor on ${n} twice a week and add collateral if it falls below 1.8 so liquidation cannot erase the points.`,
      ];
      break;
    case 'dex':
      body = [
        `Swap $${half} of USDC for the pair's other asset on ${n} (${chain}), checking price impact stays below 0.3% before you sign.`,
        `Deposit both sides, about $${cap} in total, into ${n}'s highest-volume pool and keep the LP receipt in the same wallet.`,
        `Run one swap on ${n} each week in both directions so the wallet shows trading volume as well as liquidity across ${hold} days.`,
        `Watch the pool on ${n} for impermanent loss; if the pair drifts more than 10% from entry, rebalance rather than leave it.`,
        `Vote or lock any governance or fee-share option ${n} offers for the pool, only if the lock is shorter than the ${hold}-day hold.`,
      ];
      break;
    case 'perp':
      body = [
        `Deposit $${cap} of USDC as margin on ${n} (${chain}) and leave at least 60% of it idle so a price swing cannot liquidate you.`,
        `Open a small long of about $${half} at 2x or less on ${n}, then close it within a day and note the fees and funding paid.`,
        `Open a second, opposite position on ${n} once a week so the account shows both-side volume across ${hold} days, never above 3x.`,
        `If ${n} runs a points season or volume tiers, check the tier table and keep monthly volume just above the first threshold.`,
        `Withdraw unused margin from ${n} at the end of each week and redeposit it, so idle funds are never stranded in the venue.`,
      ];
      break;
    case 'bridge':
      body = [
        `Bridge $${cap} of USDC into ${chain} through ${n}, first sending a $5 test transfer and waiting for it to land.`,
        `Use the funds bridged via ${n} on ${chain} in one app, such as a swap or a deposit, so the route ends in activity and not an idle balance.`,
        `Bridge a smaller amount of about $${half} back out through ${n} after two weeks, to show use in both directions.`,
        `Compare ${n}'s quoted fee and time with one rival route before each transfer and use ${n} only when it is not clearly worse.`,
        `Keep every ${n} receipt page; a stuck transfer is far easier to recover with the transaction hash and the timestamp in hand.`,
      ];
      break;
    case 'restaking':
      body = [
        `Stake $${cap} of the chain's native asset through ${n} on ${chain} and confirm the liquid receipt token arrives in your wallet.`,
        `Delegate the position on ${n} to an operator or validator with a clean slashing record and spread across two if it allows.`,
        `Put the receipt token into one integration that ${n} lists on its site, only if the exit queue there is under ${hold} days.`,
        `Note the unbonding period on ${n} before you start; plan the exit so your withdrawal request lands before the hold ends.`,
        `Check ${n}'s dashboard each week for the reward rate and any new restaking pool, and move only if the change is significant.`,
      ];
      break;
    case 'chain':
      body = [
        `Bridge $${cap} of ETH or USDC to ${n} (${chain}) from an exchange or a major bridge, leaving about $${gas * 2} for gas.`,
        `Use three different apps on ${n} each week, such as a swap, a lending deposit and a name or NFT mint, to show real breadth.`,
        `Deploy or interact with at least one contract on ${n} every week for ${hold} days so the wallet looks like a user and not a bot.`,
        `Join ${n}'s official channels and follow the announcements; any airdrop or points guide will be posted there first and nowhere else.`,
        `Keep gas on ${n} topped up at about $${gas} at all times, since a wallet that cannot transact cannot qualify for anything.`,
      ];
      break;
    default:
      body = [
        `Deposit $${cap} of USDC into the largest vault on ${n} (${chain}) and confirm the share token appears in your wallet.`,
        `Add to or rebalance the ${n} position once a week for ${hold} days so the activity is counted in more than one snapshot.`,
        `Read ${n}'s docs for the fee on deposits and withdrawals and for any lock-up, and compare them with the vault's displayed yield.`,
        `If ${n} offers a second, higher-risk vault, move no more than $${half} there and only after the first has run for two weeks.`,
        `Compound or claim ${n}'s earned yield at most once a week; every extra claim is a gas payment the position must earn back.`,
      ];
  }
  // Four to six steps: setup + the kind's steps (trimmed to 3 or 4), then log and claim for older or larger protocols.
  const core = body.slice(0, tvlTier(p) === 0 ? 3 : 4);
  const steps = [setup, ...core];
  if (hold > 30) steps.push(claim);
  if (steps.length < 6 && (age === null || age >= 180 || steps.length < 5)) steps.push(log);
  return steps.slice(0, 6).map((t) => fit(t, p));
}

/** 0 for a small protocol, 1 for a large one: larger ones get a longer plan. */
function tvlTier(p: SnapshotProtocol): number {
  return p.tvl_usd >= 100_000_000 ? 1 : 0;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    category_multiplier: row.model.category_multiplier,
    thin_tvl_multiplier: row.model.thin_tvl_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source.replace(/https?:\/\/[^\s,]+/g, 'the protocols endpoint'),
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
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
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
      revenue_usd: typeof p.revenue_usd === 'number' && Number.isFinite(p.revenue_usd) ? p.revenue_usd : null,
      fees_usd: typeof p.fees_usd === 'number' && Number.isFinite(p.fees_usd) ? p.fees_usd : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 4 || steps.length > 6) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 40 || s.length > 300) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  const seen = new Map<string, string>();
  for (const r of board) {
    for (const s of r.farm_steps) {
      const other = seen.get(s);
      if (other !== undefined && other !== r.slug) return `${r.slug} and ${other} share the farm step "${s.slice(0, 60)}"`;
      seen.set(s, r.slug);
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
