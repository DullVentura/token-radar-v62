// Token Radar v6.1 — mesin Ridge log-linear v6.
//
// Model v6: y = ln(mcap_usd / tvl_usd) atas protokol comps (snapshot yang
// sudah punya mcap > 0 dan lolos eksklusi ketat), difit Ridge dengan
// lambda dipilih lewat PRESS leave-one-out. Fitur: ln(TVL), g_trend
// (change_7d di-clamp, proxy slope TVL), g_season (ln median TVL kategori /
// median TVL pasar), drawdown (bagian negatif change_7d), ln(umur), plus
// dummy satu-hot per kategori. Fitur kontinu distandardisasi dari lipatan
// latih saja (tanpa leakage); intercept tidak dipenalti.
//
// P(launch) v6 memakai kalibrasi Empirical Bayes Beta-Binomial per
// (kategori, bucket umur) atas seluruh snapshot, prior = rate global,
// kekuatan k=12, clamp [0,03, 0,85].
//
// Semua urutan di-sort (slug / listed_at+slug): deterministik, tanpa
// Date/random. Satu-satunya angka beku di sini adalah definisi fitur dan
// grid lambda; koefisien dihitung live dari snapshot di tiap run.

import type { SnapshotProtocol, Snapshot } from './board5.ts';

export const AS_OF = '2026-11-14';
export const AS_OF_MS = Date.parse(AS_OF + 'T00:00:00Z');
export const LAMBDA_GRID = [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000, 3000];

// ---- eksklusi gaya watchlist/board ---------------------------------------

const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

export function isExcluded(p: SnapshotProtocol): boolean {
  if (EXCLUDED_CATEGORIES.has(p.category as string)) return true;
  const n = p.name || '';
  if (/\bwrapped\b|\bstaked\b|\bstaking\b/i.test(n)) return true;
  if (EXCHANGE_PREFIXES.some((e) => n.startsWith(e))) return true;
  if (/\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/.test(n)) return true;
  return false;
}

// ---- comps: protokol snapshot dengan FDV terealisasi ----------------------

export interface CompsAttrition {
  snapshot_total: number;
  mcap_pos_tvl_pos: number;
  mcap_nonpos: number;
  after_exclusion: number;
  dated: number;
}

export function buildComps(snapshot: Snapshot): { comps: SnapshotProtocol[]; attrition: CompsAttrition } {
  const all = snapshot.protocols;
  const attrition: CompsAttrition = {
    snapshot_total: all.length,
    mcap_pos_tvl_pos: 0,
    mcap_nonpos: 0,
    after_exclusion: 0,
    dated: 0,
  };
  const mcapPos = all.filter((p) => typeof p.mcap_usd === 'number' && p.mcap_usd! > 0 && typeof p.tvl_usd === 'number' && p.tvl_usd > 0);
  attrition.mcap_pos_tvl_pos = mcapPos.length;
  attrition.mcap_nonpos = all.filter((p) => typeof p.mcap_usd === 'number' && p.mcap_usd! <= 0).length;
  const comps = mcapPos.filter((p) => !isExcluded(p));
  attrition.after_exclusion = comps.length;
  attrition.dated = comps.filter((p) => p.listed_at).length;
  comps.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return { comps, attrition };
}

// ---- fitur ----------------------------------------------------------------

export function ageDaysV6(listedAt: string | null): number {
  if (!listedAt) return 365; // umur tak diketahui = 365 hari (konvensi v5)
  const d = Math.floor((AS_OF_MS - Date.parse(listedAt + 'T00:00:00Z')) / 86400000);
  return Math.max(1, d);
}

export function clampChange(c: number | null | undefined): number {
  const v = c === null || c === undefined ? 0 : c; // null -> 0 (konvensi v5)
  return Math.min(120, Math.max(-60, v));
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function quantile(sortedAsc: number[], q: number): number {
  if (!sortedAsc.length) return 0;
  const pos = q * (sortedAsc.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo]!;
  return sortedAsc[lo]! + (sortedAsc[hi]! - sortedAsc[lo]!) * (pos - lo);
}

export type BoardLike = SnapshotProtocol & { age_days?: number | null };

const CONT = ['lnTvl', 'g_trend', 'g_season', 'drawdown', 'lnAge'] as const;
type ContKey = (typeof CONT)[number];

function rawFeatures(p: BoardLike, medTvlCat: Map<string | null, number>, medTvlAll: number): Record<ContKey, number> {
  const ch = clampChange(p.change_7d);
  const age = p.age_days !== undefined && p.age_days !== null ? p.age_days : ageDaysV6(p.listed_at);
  const medCat = medTvlCat.get(p.category);
  const gSeason = medCat && medCat > 0 && medTvlAll > 0 ? Math.log(medCat / medTvlAll) : 0;
  return {
    lnTvl: Math.log(p.tvl_usd),
    g_trend: ch / 100,
    g_season: gSeason,
    drawdown: Math.max(0, -ch) / 100,
    lnAge: Math.log(Math.max(1, age)),
  };
}

export interface FoldStats {
  means: Record<string, number>;
  stds: Record<string, number>;
  medTvlCat: Map<string | null, number>;
  medTvlAll: number;
  catList: (string | null)[];
  cont: readonly string[];
}

/** Statistik lipatan: standardisasi + median TVL per kategori + daftar kategori — semua dari train saja. */
export function computeStats(trainRows: BoardLike[]): FoldStats {
  const tvlAll = trainRows.map((p) => p.tvl_usd).filter((v) => v > 0);
  const medTvlAll = median(tvlAll);
  const byCatTvl = new Map<string | null, number[]>();
  for (const p of trainRows) {
    if (!byCatTvl.has(p.category)) byCatTvl.set(p.category, []);
    byCatTvl.get(p.category)!.push(p.tvl_usd);
  }
  const medTvlCat = new Map([...byCatTvl.entries()].map(([c, vs]) => [c, median(vs.filter((v) => v > 0))]));
  const feats = trainRows.map((p) => rawFeatures(p, medTvlCat, medTvlAll));
  const means: Record<string, number> = {};
  const stds: Record<string, number> = {};
  for (const k of CONT) {
    const vs = feats.map((f) => f[k]);
    const m = vs.reduce((a, b) => a + b, 0) / vs.length;
    const sd = Math.sqrt(vs.reduce((a, b) => a + (b - m) ** 2, 0) / vs.length);
    means[k] = m;
    stds[k] = sd < 1e-9 ? 1 : sd;
  }
  const catList = [...new Set(trainRows.map((p) => p.category))].sort() as (string | null)[];
  return { means, stds, medTvlCat, medTvlAll, catList, cont: CONT };
}

export function designRow(p: BoardLike, stats: FoldStats): number[] {
  const f = rawFeatures(p, stats.medTvlCat, stats.medTvlAll);
  const row = [1]; // intercept (tidak dipenalti)
  for (const k of stats.cont) row.push((f[k as ContKey] - stats.means[k]!) / stats.stds[k]!);
  for (const c of stats.catList) row.push(p.category === c ? 1 : 0);
  return row;
}

export function designMatrix(rows: BoardLike[], stats: FoldStats): { X: number[][]; y: number[] } {
  const X = rows.map((p) => designRow(p, stats));
  const y = rows.map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
  return { X, y };
}

// ---- aljabar linear kecil (eliminasi Gauss + invers) ----------------------

function solve(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M = A.map((r, i) => [...r, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    if (Math.abs(M[piv]![col]!) < 1e-12) throw new Error('singular matrix');
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]! / M[col]![col]!;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  return M.map((r, i) => r[n]! / M[i]![i]!);
}

function invert(A: number[][]): number[][] {
  const n = A.length;
  const M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    if (Math.abs(M[piv]![col]!) < 1e-12) throw new Error('singular matrix');
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    const d = M[col]![col]!;
    for (let c = 0; c < 2 * n; c++) M[col]![c]! /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]!;
      if (f === 0) continue;
      for (let c = 0; c < 2 * n; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  return M.map((r) => r.slice(n));
}

function xtx(X: number[][], lambda: number, penalize: number[]): number[][] {
  const p = X[0]!.length;
  const A = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (const row of X) for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) A[i]![j]! += row[i]! * row[j]!;
  for (let i = 0; i < p; i++) A[i]![i]! += lambda * penalize[i]!;
  return A;
}

function xty(X: number[][], y: number[]): number[] {
  const p = X[0]!.length;
  const b = new Array<number>(p).fill(0);
  for (let r = 0; r < X.length; r++) for (let i = 0; i < p; i++) b[i]! += X[r]![i]! * y[r]!;
  return b;
}

export function ridgeFit(X: number[][], y: number[], lambda: number): number[] {
  const p = X[0]!.length;
  const penalize = Array.from({ length: p }, (_, i) => (i === 0 ? 0 : 1)); // intercept bebas
  return solve(xtx(X, lambda, penalize), xty(X, y));
}

export function predictOne(row: number[], beta: number[]): number {
  let s = 0;
  for (let i = 0; i < row.length; i++) s += row[i]! * beta[i]!;
  return s;
}

/** LOO eksak via PRESS (hat matrix) untuk satu lambda; fitur sudah fixed di dalam fold. */
export function pressLoo(X: number[][], y: number[], lambda: number): number[] {
  const p = X[0]!.length;
  const penalize = Array.from({ length: p }, (_, i) => (i === 0 ? 0 : 1));
  const gram = xtx(X, lambda, penalize);
  const Ainv = invert(gram);
  const beta = solve(gram, xty(X, y));
  const res: number[] = [];
  for (let r = 0; r < X.length; r++) {
    const row = X[r]!;
    let h = 0;
    for (let i = 0; i < p; i++) {
      let s = 0;
      for (let j = 0; j < p; j++) s += Ainv[i]![j]! * row[j]!;
      h += row[i]! * s;
    }
    const e = y[r]! - predictOne(row, beta);
    const denom = 1 - h;
    res.push(denom > 1e-9 ? e / denom : e);
  }
  return res;
}

/** miss = geometric-mean multiplicative error: exp(mean |ln(pred/actual)|). */
export function missFromLogResiduals(res: number[]): number | null {
  if (!res.length) return null;
  const m = res.reduce((a, b) => a + Math.abs(b), 0) / res.length;
  return Math.exp(m);
}

/** median miss = exp(median |ln(pred/actual)|) — definisi median, basis apples-to-apples vs angka v5. */
export function medianMiss(res: number[]): number | null {
  if (!res.length) return null;
  return Math.exp(median(res.map((r) => Math.abs(r))));
}

export function selectLambda(X: number[][], y: number[], grid: number[] = LAMBDA_GRID): { lambda: number; miss: number } {
  let best: { lambda: number; miss: number } | null = null;
  for (const lambda of grid) {
    const res = pressLoo(X, y, lambda);
    const miss = missFromLogResiduals(res)!;
    if (best === null || miss < best.miss) best = { lambda, miss };
  }
  return best!;
}

// ---- kalibrasi P: Empirical Bayes Beta-Binomial ---------------------------

export function ageBucketV6(age: number | null | undefined): string {
  if (age === null || age === undefined) return 'unknown';
  if (age < 365) return '<1y';
  if (age < 730) return '1-2y';
  if (age < 1095) return '2-3y';
  return '3y+';
}

export interface PCalibration {
  globalRate: number;
  K: number;
  LO: number;
  HI: number;
  pFor: (row: BoardLike) => { p: number; level: string; cohort: string };
}

/**
 * Kohort = (kategori, age-bucket) atas SELURUH snapshot 758 protokol.
 * launched = punya token (gecko_id atau symbol non-null). Prior = rate
 * global, kekuatan k=12, clamp 3%–85%.
 */
export function calibrateP(snapshot: Snapshot): PCalibration {
  const P = snapshot.protocols;
  const launched = (p: SnapshotProtocol): boolean => Boolean(p.gecko_id || p.symbol);
  const globalRate = P.filter(launched).length / P.length;
  const K = 12;
  const LO = 0.03;
  const HI = 0.85;
  const cohorts = new Map<string, { n: number; y: number }>();
  const catTot = new Map<string | null, { n: number; y: number }>();
  for (const p of P) {
    const age = p.listed_at ? ageDaysV6(p.listed_at) : null;
    const b = ageBucketV6(age);
    const key = p.category + '|' + b;
    if (!cohorts.has(key)) cohorts.set(key, { n: 0, y: 0 });
    const c = cohorts.get(key)!;
    c.n++;
    if (launched(p)) c.y++;
    if (!catTot.has(p.category)) catTot.set(p.category, { n: 0, y: 0 });
    const t = catTot.get(p.category)!;
    t.n++;
    if (launched(p)) t.y++;
  }
  const shrink = ({ n, y }: { n: number; y: number }): number => Math.min(HI, Math.max(LO, (y + K * globalRate) / (n + K)));
  const cohortP = new Map([...cohorts.entries()].map(([k, v]) => [k, shrink(v)]));
  const catP = new Map([...catTot.entries()].map(([k, v]) => [k, shrink(v)]));
  const globalP = shrink({ n: P.length, y: P.filter(launched).length });
  function pFor(row: BoardLike): { p: number; level: string; cohort: string } {
    const age = row.age_days !== undefined && row.age_days !== null ? row.age_days : ageDaysV6(row.listed_at);
    const b = ageBucketV6(age);
    const key = row.category + '|' + b;
    if (cohortP.has(key)) return { p: cohortP.get(key)!, level: 'cohort', cohort: key };
    if (catP.has(row.category)) return { p: catP.get(row.category)!, level: 'category', cohort: row.category as string };
    return { p: globalP, level: 'global', cohort: 'global' };
  }
  return { globalRate, K, LO, HI, pFor };
}
