// Token Radar v6.1 — model point-estimate v5 (peringkat board).
//
// Ranking board memakai model expected-value v5: implied = valueIfLaunches x
// P(launch | umur, kategori), dengan valueIfLaunches dari kurva ukuran
// (power-law atas mcap/TVL protokol yang sudah trade) yang diblend dengan
// median mcap/TVL kategori, dikali carry pertumbuhan 7 hari dan penalti
// drawdown; P(launch) dari kohort snapshot sendiri (share protokol yang
// sudah record token per kategori x bucket umur, dengan shrinkage k=8).
// Semua konstanta dinyatakan di dashboard; tidak ada nama protokol yang
// diistimewakan: fungsi yang sama menilai setiap baris.
//
// Farm economics: farmer diasumsikan menerima 7% dari value-if-launches,
// pro-rata deposit/TVL. Gas dari tier chain utama. net(D) = expected drop -
// fees; verdict FARM / MARGINAL / SKIP mengikuti net dan P(launch) terhadap
// break-even odds. Farm plan 6 langkah diturunkan dari record protokol
// (kategori, chain, TVL, umur) + tier gas chain-nya.

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

export type Verdict = 'FARM' | 'MARGINAL' | 'SKIP';

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
  value_if_launches: number;
  launch_odds: number;
  launch_bucket: string | null;
  p10_usd: number;
  p25_usd: number;
  p75_usd: number;
  p90_usd: number;
  fees_usd: number;
  net_1000_usd: number;
  breakeven_odds: number;
  verdict: Verdict;
  is_watchlist: boolean;
  model: {
    category_comp: number;
    powerlaw_ratio: number;
    blended_comp: number;
    growth_multiplier: number;
    drawdown_penalty: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

const DAY_MS = 86_400_000;
const SHRINK_K = 8;
const COMP_MIN = 0.08;
const COMP_MAX = 1.0;
export const FARMER_SHARE = 0.07;
export const FARM_WEEKS = 12;
export const DEFAULT_DEPOSIT = 1000;

const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Median atas (sorted[floor(n/2)]): definisi yang dipakai model ini. */
function medianUpper(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** Kuantil dengan interpolasi linear atas array yang sudah terurut. */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(sorted.length - 1, lo + 1);
  const frac = pos - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function ageBucket(age: number | null): string | null {
  if (age === null) return null;
  if (age < 365) return '<1y';
  if (age < 730) return '1-2y';
  if (age < 1095) return '2-3y';
  return '3y+';
}

/** Sebuah protokol tercatat punya token bila salah satu dari tiga field token terisi. */
export function hasToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return !hasToken(p);
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORDS = /\b(wrapped|staked|staking)\b/i;
const EXCHANGES = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)/i;

/** Alasan pertama sebuah protokol pre-token disisihkan dari board, atau null bila bisa diranking. */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (p.category === 'Bridge' || p.category === 'Canonical Bridge') return 'Bridge';
  if (p.category === 'Liquid Staking' || p.category === 'Liquid Restaking' || p.category === 'Restaked BTC') return 'Liquid staking / restaking';
  if (p.category === 'CEX') return 'Centralised exchange';
  if (VERSIONED.test(p.name)) return 'Versioned pool';
  if (WRAPPED_WORDS.test(p.name)) return 'Wrapped / staked asset';
  if (EXCHANGES.test(p.name)) return 'Exchange-branded product';
  return null;
}

export function isStrictRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && exclusionReason(p) === null;
}

// ---------------------------------------------------------------- kurva ukuran

export interface FitPoint {
  tvl: number;
  mcap: number;
  category: string;
  change_7d: number | null;
}

export interface PowerLawFit {
  intercept: number;
  slope: number;
  r_squared: number;
  n: number;
}

/** OLS log10(mcap) = intercept + slope * log10(TVL). */
export function fitPowerLaw(points: FitPoint[]): PowerLawFit {
  const n = points.length;
  if (n < 2) return { intercept: 0, slope: 0, r_squared: 0, n };
  const xs = points.map((p) => Math.log10(p.tvl));
  const ys = points.map((p) => Math.log10(p.mcap));
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  const r_squared = sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
  return { intercept, slope, r_squared, n };
}

export function powerLawRatio(tvl: number, fit: PowerLawFit): number {
  if (tvl <= 0 || fit.n < 2) return 0.25;
  return clamp(Math.pow(10, fit.intercept + fit.slope * Math.log10(tvl)) / tvl, COMP_MIN, COMP_MAX);
}

export interface CategoryComp {
  count: number;
  raw_median: number;
  shrunk: number;
}

export interface CompsFit {
  global_median: number;
  categories: Record<string, CategoryComp>;
}

/** Median mcap/TVL per kategori, di-shrink ke median global dengan prior k=8. */
export function fitCategoryComps(points: FitPoint[]): CompsFit {
  const global = medianUpper(points.map((p) => p.mcap / p.tvl));
  const byCat: Record<string, number[]> = {};
  for (const p of points) {
    if (!byCat[p.category]) byCat[p.category] = [];
    byCat[p.category]!.push(p.mcap / p.tvl);
  }
  const categories: Record<string, CategoryComp> = {};
  for (const [cat, list] of Object.entries(byCat)) {
    const raw = medianUpper(list);
    const n = list.length;
    categories[cat] = {
      count: n,
      raw_median: r4(raw),
      shrunk: clamp((n * raw + SHRINK_K * global) / (n + SHRINK_K), COMP_MIN, COMP_MAX),
    };
  }
  return { global_median: r4(global), categories };
}

export function growthMultiplier(change7d: number | null): number {
  const raw = change7d !== null && Number.isFinite(change7d) ? change7d : 0;
  return 1 + (clamp(raw, -60, 120) / 100) * 0.5;
}

export function drawdownPenalty(change7d: number | null): number {
  if (change7d !== null && change7d < -20) return Math.max(0.8, 1 + (change7d + 20) / 200);
  return 1;
}

/** Nilai bila protokol meluncurkan token, sebelum dikali peluang launch. */
export function valueIfLaunches(
  tvl: number,
  category: string | null,
  change7d: number | null,
  fit: PowerLawFit,
  comps: CompsFit,
): { value: number; cat_comp: number; powerlaw_ratio: number; blended: number; growth_mult: number; penalty: number } {
  const catComp = comps.categories[category ?? 'Other']?.shrunk ?? comps.global_median;
  const plRatio = powerLawRatio(tvl, fit);
  const blended = Math.exp(0.5 * Math.log(catComp) + 0.5 * Math.log(plRatio));
  const growthMult = growthMultiplier(change7d);
  const penalty = drawdownPenalty(change7d);
  return {
    value: tvl * blended * growthMult * penalty,
    cat_comp: catComp,
    powerlaw_ratio: plRatio,
    blended,
    growth_mult: growthMult,
    penalty,
  };
}

// ---------------------------------------------------------------- peluang launch

export interface CohortCell {
  category: string;
  bucket: string;
  traded: number;
  total: number;
  rate: number;
}

export interface CohortFit {
  global_rate: number;
  global_traded: number;
  global_total: number;
  category_rates: Record<string, { traded: number; total: number; rate: number }>;
  cells: CohortCell[];
}

function shrinkRate(traded: number, total: number, prior: number, k: number = SHRINK_K): number {
  return (traded + k * prior) / (total + k);
}

/**
 * Peluang launch dari kohort snapshot: untuk tiap (kategori, bucket umur),
 * share protokol yang sudah tercatat punya token. Bucket dengan n < 5 jatuh
 * ke rate kategori; kategori tanpa token yang trade jatuh ke rate global.
 * Di-clamp ke [0,03, 0,90].
 */
export function fitCohort(protocols: SnapshotProtocol[], asOf: string): CohortFit {
  const globalTraded = protocols.filter(hasToken).length;
  const globalTotal = protocols.length;
  const globalRate = globalTotal > 0 ? globalTraded / globalTotal : 0;
  const catTotals: Record<string, { traded: number; total: number }> = {};
  const cellCounts: Record<string, { traded: number; total: number }> = {};
  for (const p of protocols) {
    const cat = p.category ?? 'Other';
    if (!catTotals[cat]) catTotals[cat] = { traded: 0, total: 0 };
    catTotals[cat]!.total++;
    if (hasToken(p)) catTotals[cat]!.traded++;
    const bucket = ageBucket(ageDays(asOf, p.listed_at));
    if (bucket !== null) {
      const key = `${cat}||${bucket}`;
      if (!cellCounts[key]) cellCounts[key] = { traded: 0, total: 0 };
      cellCounts[key]!.total++;
      if (hasToken(p)) cellCounts[key]!.traded++;
    }
  }
  const categoryRates: Record<string, { traded: number; total: number; rate: number }> = {};
  for (const [cat, t] of Object.entries(catTotals)) {
    categoryRates[cat] = { traded: t.traded, total: t.total, rate: r4(shrinkRate(t.traded, t.total, globalRate)) };
  }
  const cells: CohortCell[] = [];
  for (const [key, t] of Object.entries(cellCounts)) {
    const [cat, bucket] = key.split('||');
    const catRate = categoryRates[cat!]!.rate;
    const rate = t.total < 5 ? catRate : shrinkRate(t.traded, t.total, catRate);
    cells.push({ category: cat!, bucket: bucket!, traded: t.traded, total: t.total, rate: r4(rate) });
  }
  cells.sort((a, b) => b.total - a.total || (a.category < b.category ? -1 : 1));
  return { global_rate: r4(globalRate), global_traded: globalTraded, global_total: globalTotal, category_rates: categoryRates, cells };
}

/** P(launch) satu protokol dari kohort yang sudah di-fit. */
export function launchOdds(age: number | null, category: string | null, cohort: CohortFit): { p: number; bucket: string | null; cell: CohortCell | null; category_rate: number } {
  const cat = category ?? 'Other';
  const catRate = cohort.category_rates[cat]?.rate ?? cohort.global_rate;
  const bucket = ageBucket(age);
  let cell: CohortCell | null = null;
  let p = catRate;
  if (bucket !== null) {
    cell = cohort.cells.find((c) => c.category === cat && c.bucket === bucket) ?? null;
    if (cell !== null && cell.total >= 5) p = cell.rate;
  }
  p = Math.min(0.9, Math.max(0.03, p));
  return { p: r4(p), bucket, cell, category_rate: r4(catRate) };
}

/** implied = valueIfLaunches x P(launch), minimal $1, dolar bulat. */
export function impliedValue(valueIf: number, pLaunch: number): number {
  return Math.max(1, Math.round(valueIf * pLaunch));
}

// ---------------------------------------------------------------- gas + farm

export interface GasTier {
  label: string;
  setup_usd: number;
  weekly_usd: number;
  exit_usd: number;
}

export function gasTierFor(chains: string[]): GasTier {
  const primary = (chains.length > 0 ? chains[0]! : 'Ethereum').toLowerCase();
  if (primary.includes('solana') || primary.includes('sol')) return { label: 'Solana', setup_usd: 0.05, weekly_usd: 0.01, exit_usd: 0.05 };
  if (primary.includes('ethereum')) return { label: 'Ethereum L1', setup_usd: 20, weekly_usd: 5, exit_usd: 15 };
  if (primary.includes('bnb') || primary.includes('binance')) return { label: 'BNB Chain', setup_usd: 0.55, weekly_usd: 0.17, exit_usd: 0.55 };
  if (
    primary.includes('base') || primary.includes('arbitrum') || primary.includes('optimism') ||
    primary.includes('blast') || primary.includes('polygon') || primary.includes('zksync') ||
    primary.includes('linea') || primary.includes('scroll') || primary.includes('unichain') ||
    primary.includes('mode') || primary.includes('mantle')
  ) {
    return { label: 'L2 rollup', setup_usd: 0.35, weekly_usd: 0.1, exit_usd: 0.35 };
  }
  return { label: 'Alt L1 / L2', setup_usd: 1, weekly_usd: 0.35, exit_usd: 1 };
}

/** Total gas untuk farm 12 minggu: setup + cek mingguan + exit. */
export function farmFees(tier: GasTier, weeks: number = FARM_WEEKS): number {
  return Math.round((tier.setup_usd + weeks * tier.weekly_usd + tier.exit_usd) * 100) / 100;
}

/** Drop yang diharapkan farmer pada deposit D dan share s. */
export function expectedDrop(implied: number, tvl: number, deposit: number, share: number = FARMER_SHARE): number {
  if (tvl <= 0) return 0;
  return (share * implied * deposit) / tvl;
}

/** net(D) = expected drop - gas. */
export function netIfLaunch(implied: number, tvl: number, fees: number, deposit: number, share: number = FARMER_SHARE): number {
  return Math.round((expectedDrop(implied, tvl, deposit, share) - fees) * 100) / 100;
}

/** P(launch) saat rencana ini impas. */
export function breakEvenOdds(valueIf: number, tvl: number, fees: number, deposit: number, share: number = FARMER_SHARE): number {
  const denom = (share * valueIf * deposit) / Math.max(1, tvl);
  if (denom <= 0) return 1;
  return Math.min(1, Math.max(0, Math.round((fees / denom) * 1e4) / 1e4));
}

/** Verdict pada satu deposit: FARM bila net >= $5 dan odds 2x break-even. */
export function farmVerdict(net: number, pLaunch: number, breakEven: number): Verdict {
  if (net >= 5 && pLaunch >= 2 * breakEven && breakEven > 0) return 'FARM';
  if (net >= 0 && pLaunch >= breakEven) return 'MARGINAL';
  return 'SKIP';
}

// ---------------------------------------------------------------- rencana farm

export type FarmGroup = 'curator' | 'lending' | 'derivatives' | 'prediction' | 'rwa' | 'liquidity' | 'chain' | 'core';

export function farmGroupOf(category: string | null): FarmGroup {
  const c = (category ?? '').toLowerCase();
  if (c.includes('curator') || c.includes('allocator')) return 'curator';
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c.includes('derivative') || c.includes('perp') || c.includes('basis') || c.includes('option') || c.includes('leveraged')) return 'derivatives';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('dex') || c.includes('yield') || c.includes('liquidity') || c.includes('farm')) return 'liquidity';
  if (c.includes('chain')) return 'chain';
  return 'core';
}

function chainGasText(tier: GasTier): string {
  if (tier.label === 'Ethereum L1') return '$15-$30 in L1 gas';
  if (tier.label === 'Solana') return 'under $0.05 in SOL gas';
  if (tier.label === 'BNB Chain') return '$0.30-$0.80 in BNB gas';
  if (tier.label === 'L2 rollup') return '$0.20-$0.50 in L2 gas';
  return '$0.50-$2.00 in native gas';
}

function chainWeeklyText(tier: GasTier): string {
  if (tier.label === 'Ethereum L1') return '$5-$10 in gas';
  if (tier.label === 'Solana') return 'under $0.01 in gas';
  if (tier.label === 'BNB Chain') return '$0.10-$0.25 in gas';
  if (tier.label === 'L2 rollup') return '$0.05-$0.15 in gas';
  return '$0.20-$0.50 in gas';
}

function categoryRisk(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('curator') || c.includes('allocator')) return 'vault rebalancing drift and underlying debt pool default risk';
  if (c.includes('lend') || c.includes('cdp')) return 'oracle latency, collateral liquidation thresholds, and sudden borrow rate spikes';
  if (c.includes('dex') || c.includes('yield') || c.includes('farm')) return 'impermanent loss during asset divergence and pool rebalancing fees';
  if (c.includes('derivative') || c.includes('perp') || c.includes('basis')) return 'margin liquidation from volatility wicks and funding rate drain';
  if (c.includes('prediction')) return 'binary outcome dispute delays and capital lock-up until market resolution';
  if (c.includes('rwa')) return 'accredited KYC restrictions and secondary redemption illiquidity';
  if (c.includes('chain')) return 'reorg risk, sequencer downtime, and validator unbonding lock periods';
  return 'smart contract vulnerability risk and liquidity slippage during withdrawal';
}

function coreAction(group: FarmGroup, name: string, capital: number, chain: string): string {
  switch (group) {
    case 'curator':
      return `Deposit $${capital} USDC into ${name}'s verified risk-curated vault on ${chain}; confirm the vault address on the official dashboard and keep the share receipt.`;
    case 'lending':
      return `Supply $${capital} USDC as collateral to ${name} on ${chain}; keep the health factor above 2.0 and borrow under 50% LTV only if the loop earns points.`;
    case 'derivatives':
      return `Fund $${capital} margin into ${name} on ${chain}; open a low-leverage (1-2x) delta-neutral position and set a stop-loss before leaving the screen.`;
    case 'prediction':
      return `Commit $${capital} into ${name}'s highest-volume live prediction market on ${chain}; pick markets resolving soon and size below 5% of the pool.`;
    case 'rwa':
      return `Mint $${capital} of ${name}'s asset-backed yield receipts on ${chain}; confirm the receipt contract in the official docs before approving anything.`;
    case 'liquidity':
      return `Provide $${capital} as split USDC/ETH liquidity into ${name}'s primary pool on ${chain}; stake the LP shares in the official gauge if one exists.`;
    case 'chain':
      return `Bridge $${capital} to ${chain} via the canonical gateway; confirm the destination address on the official explorer before sending.`;
    default:
      return `Deposit $${capital} into ${name}'s core protocol pool on ${chain} and retain the vault share receipt as proof of position.`;
  }
}

function weeklyAction(group: FarmGroup, name: string, chain2: string | null): string {
  const extra = chain2 !== null ? ` Repeat the core action once on ${chain2} with $50 to cover a second chain.` : '';
  switch (group) {
    case 'curator':
      return `Review ${name}'s vault allocation and curator score every 7 days; note each rebalance and keep a dated log of positions.${extra}`;
    case 'lending':
      return `Check borrow APY and collateral ratio every 7 days; repay or top up collateral within 24 hours if the rate spikes or the health factor falls.${extra}`;
    case 'derivatives':
      return `Check funding rates and margin ratio every 7 days; close or flip the hedge if funding turns negative for two consecutive epochs.${extra}`;
    case 'liquidity':
      return `Harvest rewards and re-stake them every 7 days; rebalance the range only when the price drifts beyond the active band.${extra}`;
    case 'chain':
      return `Execute at least 3 native interactions on ${name} (swap, stake, or vote) over 7 days; keep each transaction above the dust threshold so it counts.${extra}`;
    case 'prediction':
      return `Review open markets every 7 days and note resolution dates; never chase a market after the odds collapse.${extra}`;
    case 'rwa':
      return `Check accrued yield and redemption windows every 7 days; queue redemption early because settlement can take 24-72 hours.${extra}`;
    default:
      return `Repeat one core interaction every 7 days (deposit, claim, or micro-swap) to keep the wallet streak alive.${extra}`;
  }
}

function exitAction(group: FarmGroup): string {
  switch (group) {
    case 'lending':
      return 'Repay any borrow in full, withdraw the collateral, revoke token allowances, and log every transaction hash and date in the farm ledger.';
    case 'derivatives':
      return 'Close the position, withdraw the margin, revoke token allowances, and log entry and exit prices plus every transaction hash.';
    case 'prediction':
      return 'Claim winnings only via the official claim button, revoke token allowances, and log market IDs, outcomes, and transaction hashes.';
    case 'rwa':
      return 'Redeem receipts through the official portal, revoke token allowances, and log receipt IDs and transaction hashes in the farm ledger.';
    case 'liquidity':
      return 'Remove liquidity, unstake LP shares, swap dust back to USDC, revoke token allowances, and log all transaction hashes in the farm ledger.';
    case 'chain':
      return 'Bridge funds back, revoke token allowances, and log every transaction hash and date in the farm ledger.';
    default:
      return 'When the campaign ends, withdraw to the burner wallet, revoke open allowances, and log wallet, transaction hashes, and entry dates in the farm ledger.';
  }
}

/**
 * Rencana farm satu protokol: enam langkah, masing-masing aksi dengan biaya
 * dan waktunya. Diturunkan dari record protokol sendiri (kategori, chain,
 * TVL, umur) dan tier gas chain-nya — bukan dari daftar nama yang ditulis tangan.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const capital = p.tvl_usd >= 1e9 ? 250 : p.tvl_usd >= 1e8 ? 150 : p.tvl_usd >= 2.5e7 ? 100 : 50;
  const hold = age === null || age < 180 ? 60 : age < 365 ? 45 : 30;
  const chain = p.chains.length > 0 ? p.chains[0]! : 'Ethereum';
  const chain2 = p.chains.length > 1 ? p.chains[1]! : null;
  const tier = gasTierFor(p.chains);
  const group = farmGroupOf(p.category);
  const steps = [
    `Open a fresh burner wallet used only for ${p.name} on ${chain}; write the seed offline, never reuse it elsewhere, and fund it with gas reserve only. Cost: Gas: ${chainGasText(tier)}. Time: 10 minutes setup.`,
    `${coreAction(group, p.name, capital, chain)} Cost: Capital: $${capital} deposited + ${chainGasText(tier)}. Time: 15 minutes deployment.`,
    `${weeklyAction(group, p.name, chain2)} Cost: Recurring: ${chainWeeklyText(tier)} per weekly check. Time: 5 minutes weekly.`,
    `Hold the position for at least ${hold} days to span several snapshot epochs; watch for ${categoryRisk(p.category)}. Cost: Zero extra cash; $${capital} opportunity cost during ${hold}d lock. Time: ${hold} days continuous holding.`,
    `Verify the position and accrued points only on ${p.name}'s official dashboard or governance portal; never pay a third-party claim fee and never sign permit or blind signatures. Cost: $0 zero fee; beware drainer scams. Time: 10 minutes review.`,
    `${exitAction(group)} Cost: Gas: under ${chainWeeklyText(tier)} for allowance cleanup. Time: 5 minutes unwinding.`,
  ];
  return steps.map((s) => {
    let text = s;
    if (text.length > 600) text = `${text.slice(0, 596)}...`;
    if (text.length < 20) text = `${text} Hold the position and check official announcement channels.`;
    return text;
  });
}

// ---------------------------------------------------------------- validasi v5

/** Residual log LOO varian penuh (size + kategori + growth + drawdown). */
export function looResiduals(points: FitPoint[]): number[] {
  const residuals: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const rest = points.filter((_, j) => j !== i);
    const fit = fitPowerLaw(rest);
    const comps = fitCategoryComps(rest);
    const pt = points[i]!;
    const v = valueIfLaunches(pt.tvl, pt.category, pt.change_7d, fit, comps);
    residuals.push(Math.log(pt.mcap / v.value));
  }
  return residuals.sort((a, b) => a - b);
}

/** Kuantil residual LOO (P10/P25/P75/P90) untuk band interval board v5. */
export function looBand(points: FitPoint[]): { q10: number; q25: number; q75: number; q90: number } {
  const residuals = looResiduals(points);
  return {
    q10: quantile(residuals, 0.1),
    q25: quantile(residuals, 0.25),
    q75: quantile(residuals, 0.75),
    q90: quantile(residuals, 0.9),
  };
}

// ---------------------------------------------------------------- build board

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new Error('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new Error('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new Error('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new Error('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new Error('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new Error(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
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
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Bangun board 198 baris dari snapshot: fit, kohort, skor, urutkan. */
export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; fitPoints: FitPoint[] } {
  const fitProtocols = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.listed_at !== null);
  const fitPoints: FitPoint[] = fitProtocols.map((p) => ({
    tvl: p.tvl_usd,
    mcap: p.mcap_usd as number,
    category: p.category ?? 'Other',
    change_7d: p.change_7d,
  }));
  const fit = fitPowerLaw(fitPoints);
  const comps = fitCategoryComps(fitPoints);
  const cohort = fitCohort(snapshot.protocols, snapshot.as_of);
  const band = looBand(fitPoints);

  const rankable = snapshot.protocols.filter(isStrictRankable);
  const wlSet = new Set(snapshot.watchlist);
  const scored = rankable.map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const v = valueIfLaunches(p.tvl_usd, p.category, p.change_7d, fit, comps);
    const odds = launchOdds(age, p.category, cohort);
    // Bulatkan V dan P dulu, lalu implied dari pasangan yang dibulatkan,
    // supaya dashboard menghitung ulang angka board.json secara persis.
    const valueIf = Math.max(1, Math.round(v.value));
    const implied = impliedValue(valueIf, odds.p);
    const tier = gasTierFor(p.chains);
    const fees = farmFees(tier);
    const net1000 = netIfLaunch(implied, p.tvl_usd, fees, DEFAULT_DEPOSIT);
    const be = breakEvenOdds(valueIf, p.tvl_usd, fees, DEFAULT_DEPOSIT);
    const verdict = farmVerdict(net1000, odds.p, be);
    return { p, age, v, odds, valueIf, implied, fees, net1000, be, verdict };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board: BoardRow[] = scored.map((s, i) => ({
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
    value_if_launches: Math.max(1, Math.round(s.valueIf)),
    launch_odds: s.odds.p,
    launch_bucket: s.odds.bucket,
    p10_usd: Math.max(1, Math.round(s.implied * Math.exp(band.q10))),
    p25_usd: Math.max(1, Math.round(s.implied * Math.exp(band.q25))),
    p75_usd: Math.max(1, Math.round(s.implied * Math.exp(band.q75))),
    p90_usd: Math.max(1, Math.round(s.implied * Math.exp(band.q90))),
    fees_usd: s.fees,
    net_1000_usd: s.net1000,
    breakeven_odds: s.be,
    verdict: s.verdict,
    is_watchlist: wlSet.has(s.p.slug),
    model: {
      category_comp: r4(s.v.cat_comp),
      powerlaw_ratio: r4(s.v.powerlaw_ratio),
      blended_comp: r4(s.v.blended),
      growth_multiplier: r4(s.v.growth_mult),
      drawdown_penalty: r4(s.v.penalty),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
  return { board, fitPoints };
}

/** Kenapa board ini ditolak gate, atau null bila lolos. */
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
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}
