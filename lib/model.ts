// Launch Multiple model for the token launch radar.
//
// The board ranks protocols that record no token yet (both gecko_id and symbol null in the snapshot)
// by the value a first token could plausibly carry if the protocol's record stayed as it is. Products
// of a token that already trades are not launches: wrapped, staked or bridged versions of one, and
// centralised exchanges, are set aside by the same exclusions the snapshot's watchlist uses (category,
// a versioned name, a wrapped/staked name, an exchange's name at the front). The $50M watchlist floor
// is NOT applied: the radar ranks every genuinely pre-token protocol, about two hundred of them, and
// the watchlist's 40 are a subset it must never lose.
//
//   implied_value_usd = round( tvl_usd x family_multiple x momentum x maturity x breadth )
//
//   family_multiple  what tokens of this kind of protocol have historically carried against TVL:
//                    chains and prediction markets high, lending and stablecoin issuers low,
//                    vault curators lowest (their token would capture fees on assets, not the assets).
//   momentum         1 + clamp(change_7d, -25, +40) / 100 x 0.9. A week of TVL growth beyond +40%
//                    is treated as noise or incentive froth, not signal; a fall past -25% is floored
//                    so one bad week cannot zero a large protocol. Unreported change scores neutral.
//   maturity         0.70 + 0.45 x age / (age + 420), age in days since DefiLlama first tracked the
//                    protocol: a launch after three live years is worth about 1.6x the same TVL
//                    launched in its first month, and the curve saturates instead of growing forever.
//                    An unreported listing date scores as 400 days, near the board's middle.
//   breadth          1 + 0.02 per extra chain beyond the first, capped at five: distribution a
//                    token can be farmed and traded on from day one.
//
// No protocol is named anywhere in this file: the same function scores every row, and ties break on
// TVL then slug, so two runs write identical bytes.

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
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

// ------------------------------------------------------------------ selection

/** Categories that are a product of a token that already trades, or an exchange, never a launch. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol records no token at all. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is a product of a token that already trades, or an exchange: set aside. */
export function isProductOrExchange(p: SnapshotProtocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  if (VERSIONED.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}

/** Whether the board may rank a protocol: it records no token and is no product of one that trades. */
export function isRankable(p: SnapshotProtocol): boolean {
  return recordsNoToken(p) && !isProductOrExchange(p);
}

// ------------------------------------------------------------------ the value model

/** A category family's label and the multiple of TVL its first token is modelled to carry. */
interface Family {
  label: string;
  multiple: number;
}

const FAMILIES: Record<string, Family> = {
  Chain: { label: 'Chain', multiple: 2.2 },
  'Prediction Market': { label: 'Prediction market', multiple: 1.6 },
  Payments: { label: 'Payments', multiple: 1.4 },
  'Crypto Card Issuer': { label: 'Payments', multiple: 1.4 },
  Privacy: { label: 'Privacy', multiple: 1.3 },
  Dexs: { label: 'Spot DEX', multiple: 1.2 },
  Derivatives: { label: 'Derivatives', multiple: 1.0 },
  'Interest Rate Derivatives': { label: 'Derivatives', multiple: 1.0 },
  'Options Vault': { label: 'Derivatives', multiple: 1.0 },
  RWA: { label: 'Real-world assets', multiple: 0.9 },
  'Staking Pool': { label: 'Staking', multiple: 0.85 },
  Restaking: { label: 'Staking', multiple: 0.85 },
  'Cross Chain Bridge': { label: 'Bridge technology', multiple: 0.8 },
  'OTC Marketplace': { label: 'OTC market', multiple: 0.8 },
  Yield: { label: 'Yield', multiple: 0.7 },
  'Yield Aggregator': { label: 'Yield', multiple: 0.7 },
  Farm: { label: 'Yield', multiple: 0.7 },
  'Leveraged Farming': { label: 'Yield', multiple: 0.7 },
  'Basis Trading': { label: 'Yield', multiple: 0.7 },
  'Liquidity Manager': { label: 'Yield', multiple: 0.7 },
  Indexes: { label: 'Indexes', multiple: 0.6 },
  CeDeFi: { label: 'Lending', multiple: 0.55 },
  Lending: { label: 'Lending', multiple: 0.55 },
  CDP: { label: 'Lending', multiple: 0.55 },
  'CDP Manager': { label: 'Lending', multiple: 0.55 },
  'Uncollateralized Lending': { label: 'Lending', multiple: 0.55 },
  'Collateral Markets': { label: 'Lending', multiple: 0.55 },
  Insurance: { label: 'Insurance', multiple: 0.5 },
  'Governance Incentives': { label: 'Governance', multiple: 0.5 },
  'Anchor BTC': { label: 'Bitcoin asset', multiple: 0.5 },
  'Decentralized BTC': { label: 'Bitcoin asset', multiple: 0.5 },
  'Risk Curators': { label: 'Vault curator', multiple: 0.45 },
  'Onchain Capital Allocator': { label: 'Vault curator', multiple: 0.45 },
  'Dual-Token Stablecoin': { label: 'Stablecoin issuer', multiple: 0.35 },
  'Stablecoin Wrapper': { label: 'Stablecoin issuer', multiple: 0.35 },
};

const DEFAULT_FAMILY: Family = { label: 'Other', multiple: 0.65 };

/** The family a protocol's category belongs to; an unnamed category scores the default. */
export function familyOf(p: SnapshotProtocol): Family {
  if (p.category === null) return DEFAULT_FAMILY;
  return FAMILIES[p.category] ?? DEFAULT_FAMILY;
}

const MOMENTUM_FLOOR = -25;
const MOMENTUM_CAP = 40;
const MOMENTUM_WEIGHT = 0.9;
const UNKNOWN_AGE_DAYS = 400;

const DAY_MS = 86_400_000;

/** Whole days from listed_at to the snapshot's as_of, clamped at zero; null when unreported or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The model's four factors for one protocol, and the implied value they multiply to. */
export interface Scored {
  family: Family;
  momentum: number;
  maturity: number;
  breadth: number;
  age_days: number | null;
  implied_value_usd: number;
}

/** Score one protocol from its own figures alone. */
export function score(p: SnapshotProtocol, asOf: string): Scored {
  const family = familyOf(p);
  const rawChange = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const clamped = Math.min(MOMENTUM_CAP, Math.max(MOMENTUM_FLOOR, rawChange));
  const momentum = 1 + (clamped / 100) * MOMENTUM_WEIGHT;
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? UNKNOWN_AGE_DAYS;
  const maturity = 0.7 + 0.45 * (ageForModel / (ageForModel + 420));
  const breadth = 1 + 0.02 * Math.min(Math.max(p.chains.length - 1, 0), 5);
  const implied = Math.max(1, Math.round(p.tvl_usd * family.multiple * momentum * maturity * breadth));
  return { family, momentum, maturity, breadth, age_days: age, implied_value_usd: implied };
}

// ------------------------------------------------------------------ farm plans

/** A deterministic small hash of a slug, so wording varies by protocol without any randomness. */
function slugHash(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h;
}

/** Pick one of `options` by the protocol's own slug: stable across runs, varied across rows. */
function pick<T>(slug: string, salt: number, options: readonly T[]): T {
  return options[(slugHash(slug) + salt) % options.length]!;
}

interface GasProfile {
  label: string;
  perTx: string;
  weekly: string;
}

const GAS_BY_CHAIN: Record<string, GasProfile> = {
  Ethereum: { label: 'Ethereum mainnet', perTx: '$6–18', weekly: '$25–60' },
  Solana: { label: 'Solana', perTx: 'under $0.05', weekly: 'under $1' },
  Bitcoin: { label: 'Bitcoin', perTx: '$1–5', weekly: '$5–15' },
};

const CHEAP_EVM = new Set([
  'Arbitrum', 'Base', 'Optimism', 'Linea', 'Scroll', 'Unichain', 'Polygon', 'Binance', 'Avalanche',
  'Mantle', 'Sonic', 'Berachain', 'Monad', 'Celo', 'Plasma', 'Sui', 'Near', 'Tron', 'CORE', 'Hemi',
]);

/** What transactions cost on the protocol's first chain, in the ranges a farmer actually budgets. */
function gasOf(p: SnapshotProtocol): GasProfile {
  const first = p.chains[0];
  if (first !== undefined && GAS_BY_CHAIN[first] !== undefined) return GAS_BY_CHAIN[first]!;
  if (first !== undefined && CHEAP_EVM.has(first)) {
    return { label: first, perTx: '$0.10–1.50', weekly: '$1–5' };
  }
  return { label: first ?? 'its main chain', perTx: '$1–4', weekly: '$4–12' };
}

/** The capital a sensible farm position needs, from the protocol's own TVL tier. */
function capitalFor(tvl: number): number {
  if (tvl >= 2_000_000_000) return 500;
  if (tvl >= 750_000_000) return 300;
  if (tvl >= 250_000_000) return 200;
  if (tvl >= 75_000_000) return 120;
  if (tvl >= 25_000_000) return 80;
  return 50;
}

/** How many weeks to farm, from how long the protocol has already run without a token. */
function weeksFor(age: number | null): string {
  if (age === null || age < 240) return '8–12 weeks';
  if (age <= 720) return '6–10 weeks';
  return '5–8 weeks';
}

/** The family's core and second actions, written for that kind of protocol. */
function actionsFor(familyLabel: string): { core: string; deepen: string } {
  switch (familyLabel) {
    case 'Spot DEX':
      return {
        core: 'make {n} swaps a week in the deepest pair and add {cap} of two-sided liquidity to a core pool',
        deepen: 'rebalance the LP position weekly and vote in any gauge or fee-sharing poll the app opens',
      };
    case 'Derivatives':
      return {
        core: 'deposit {cap} of margin collateral and run small hedged positions, long and short in turn',
        deepen: 'keep a steady weekly volume with tight position sizes rather than a few large trades',
      };
    case 'Lending':
      return {
        core: 'supply {cap} of a blue-chip asset (USDC or ETH) and borrow 25–35% against it, then repay and repeat the cycle monthly',
        deepen: 'rotate part of the supply into a second market the app lists so activity spans more than one pool',
      };
    case 'Vault curator':
      return {
        core: 'deposit {cap} of USDC into the curator\'s largest vault and hold the vault shares untouched',
        deepen: 'split a second, smaller deposit into a different vault under the same curator to diversify strategy risk',
      };
    case 'Yield':
      return {
        core: 'deposit {cap} into the main vault or strategy and let the position compound instead of harvesting early',
        deepen: 'add a small top-up every week so the deposit history shows steady growth, not one lump',
      };
    case 'Staking':
      return {
        core: 'stake {cap} of the chain\'s native asset and hold the liquid receipt token in the same wallet',
        deepen: 'restake or lend the receipt token inside the app where it is supported, and keep it there',
      };
    case 'Real-world assets':
      return {
        core: 'subscribe {cap} to the protocol\'s yield-bearing asset and hold it through at least one full accrual or coupon cycle',
        deepen: 'complete the app\'s verification steps early; RWA platforms usually snapshot holders, not traders',
      };
    case 'Chain':
      return {
        core: 'bridge {cap} onto the chain and transact with it every week: transfers, swaps and two native apps',
        deepen: 'use the chain\'s own bridge and explorer-verified contracts, and keep a small native gas balance parked',
      };
    case 'Bridge technology':
      return {
        core: 'bridge {cap} in both directions at least twice a month, and use the received funds on the destination chain',
        deepen: 'vary the routes and amounts modestly; identical round trips on a timer read as bot traffic',
      };
    case 'Prediction market':
      return {
        core: 'fund the account with {cap} and take small positions in the most liquid markets, on both sides over time',
        deepen: 'provide liquidity to a market book where the app allows it and let positions settle rather than exiting early',
      };
    case 'Payments':
      return {
        core: 'activate the account, load {cap} and route real everyday spending or transfers through it weekly',
        deepen: 'keep a standing balance in the app between uses; balances, not just transaction counts, are what get snapshotted',
      };
    case 'Stablecoin issuer':
      return {
        core: 'mint {cap} of the stablecoin against collateral and hold or deploy it inside the app\'s own markets',
        deepen: 'keep the collateral ratio comfortably above the liquidation line and rebalance after volatile weeks',
      };
    case 'Bitcoin asset':
      return {
        core: 'deposit {cap} of BTC (or its wrapped form on the supported chain) and hold the issued position without wrapping back',
        deepen: 'use the position in the app\'s own lending or yield market rather than leaving it idle',
      };
    case 'Insurance':
      return {
        core: 'buy {cap} of cover on a position you actually hold elsewhere and keep the policy to expiry',
        deepen: 'renew once; underwriters reward wallets with a claims-free history across more than one period',
      };
    default:
      return {
        core: 'deposit {cap} of USDC into the protocol\'s main product and use its core feature every week',
        deepen: 'try the app\'s second feature (a second market, vault or module) so the wallet history is not one-dimensional',
      };
  }
}

const fmtUsd = (n: number): string => `$${n.toLocaleString('en-US')}`;

/** A compact dollar figure for running text: $2.75B, $320.2M, $850K. */
function fmtCompact(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${n}`;
}

/** A chain list short enough for a sentence: the first four names, then a count of the rest. */
function shortChains(p: SnapshotProtocol): string {
  if (p.chains.length === 0) return 'one chain';
  if (p.chains.length <= 4) return p.chains.join(', ');
  return `${p.chains.slice(0, 4).join(', ')} and ${p.chains.length - 4} more`;
}

/**
 * A protocol's farm plan: five steps (six for the largest protocols), each generated from the
 * protocol's own category family, chains, TVL tier and age. Every step names an action, what it
 * costs and how long it runs; the wording template is picked by the protocol's slug so two rows
 * rarely read alike.
 */
export function farmSteps(p: SnapshotProtocol, s: Scored): string[] {
  const gas = gasOf(p);
  const capital = capitalFor(p.tvl_usd);
  const weeks = weeksFor(s.age_days);
  const fam = actionsFor(s.family.label);
  const chainList = shortChains(p);
  const core = fam.core.replace('{cap}', fmtUsd(capital)).replace('{n}', String(3 + (slugHash(p.slug) % 3)));
  const steps: string[] = [];

  steps.push(
    pick(p.slug, 1, [
      `Set up a fresh wallet for ${p.name} alone and fund it on ${gas.label} (${chainList}). Budget ${fmtUsd(capital)} of working capital plus ${gas.weekly} a week for gas; on ${gas.label} each transaction runs about ${gas.perTx}.`,
      `Use one dedicated wallet for ${p.name} and keep its keys offline. Fund it on ${gas.label} with ${fmtUsd(capital)} to deploy and a gas float covering ${gas.weekly} a week (roughly ${gas.perTx} per transaction).`,
    ]),
  );
  steps.push(
    pick(p.slug, 2, [
      `Core position: ${core}. Do it inside ${p.name}'s own app on ${p.chains[0] ?? gas.label}, not through an aggregator, so the activity is attributed to your wallet.`,
      `Open the core position in ${p.name}'s app: ${core}. Always transact on ${p.chains[0] ?? gas.label} directly in the app so the wallet history is unambiguous.`,
    ]),
  );
  steps.push(
    `Repeat in 2–3 short sessions a week for ${weeks}: ${fam.deepen}. Steady cadence over ${weeks} counts for more in most snapshots than the same volume in one weekend.`,
  );
  if (p.chains.length >= 2) {
    steps.push(
      `Extend to ${p.chains[1]}: ${p.name} tracks ${p.chains.length} chains (${chainList}), so repeat a smaller version of the core position there — about a third of the capital — to appear in more than one chain's records.`,
    );
  } else {
    steps.push(
      `Stay on ${p.chains[0] ?? gas.label} but widen the footprint: use a second product surface of ${p.name} (a second market, pool or module) at least twice a month, so the wallet is not flagged as single-action.`,
    );
  }
  steps.push(
    pick(p.slug, 5, [
      `Keep a farm log (wallet, dates, amounts, transaction hashes) and check ${p.name}'s official channels weekly for a points programme or snapshot notice. Never pay a third party to "claim" anything; claims only ever come from the protocol's own app.`,
      `Log every session with dates and hashes, and re-check the position monthly. If ${p.name} announces points or a snapshot, claim only through links in its own app or docs — never through a search result or a DM.`,
    ]),
  );
  if (p.tvl_usd >= 750_000_000) {
    steps.push(
      `Size discipline for a protocol of this scale (${fmtCompact(p.tvl_usd)} TVL): cap the position at the ${fmtUsd(capital)} planned here, split collateral across two asset types where the app allows, and review exposure monthly rather than chasing every new market it lists.`,
    );
  }
  return steps;
}

// ------------------------------------------------------------------ the board

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  family: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  farm_steps: string[];
}

/** The dashboard's view of one row: the figures, the model's factors and the plan. */
export interface DashRow extends BoardRow {
  multiple: number;
  momentum: number;
  maturity: number;
  breadth: number;
}

/** Everything the dashboard renders. */
export interface BoardData {
  as_of: string;
  floor_usd: number;
  tracked: number;
  tokened: number;
  no_token_recorded: number;
  set_aside: number;
  ranked: number;
  watchlist_size: number;
  rows: DashRow[];
  categories: string[];
  chains: string[];
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Build the ranked board and the dashboard's dataset from the snapshot. */
export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; data: BoardData } {
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => isRankable(p) || watch.has(p.slug));
  const scored = chosen.map((p) => ({ p, s: score(p, snapshot.as_of) }));
  scored.sort(
    (a, b) =>
      b.s.implied_value_usd - a.s.implied_value_usd ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  const rows: DashRow[] = scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    family: s.family.label,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    age_days: s.age_days,
    watchlist: watch.has(p.slug),
    implied_value_usd: s.implied_value_usd,
    farm_steps: farmSteps(p, s),
    multiple: s.family.multiple,
    momentum: round4(s.momentum),
    maturity: round4(s.maturity),
    breadth: round4(s.breadth),
  }));
  const board: BoardRow[] = rows.map(({ multiple, momentum, maturity, breadth, ...rest }) => rest);
  const noToken = snapshot.protocols.filter(recordsNoToken).length;
  const data: BoardData = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    tracked: snapshot.protocols.length,
    tokened: snapshot.protocols.length - noToken,
    no_token_recorded: noToken,
    set_aside: noToken - rows.length,
    ranked: rows.length,
    watchlist_size: snapshot.watchlist.length,
    rows,
    categories: [...new Set(rows.map((r) => r.category ?? 'Uncategorised'))].sort(),
    chains: [...new Set(rows.flatMap((r) => r.chains))].sort(),
  };
  return { board, data };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: not a ranking';
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
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
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(data: BoardData): string {
  return `window.BOARD_DATA=${JSON.stringify(data)};\n`;
}
