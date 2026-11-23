// Token Radar v6.1 — refit v6 live dari snapshot.
//
// Menjalankan ulang refit T1 di dalam sandbox, dari snapshot yang sama:
// nested LOO (outer refit eksplisit, inner lambda via PRESS), noise floor
// baseline rata-rata global, walk-forward expanding window 5 blok, range
// holds dari kuantil residual LOO per kategori, lalu fit final atas semua
// comps + kalibrasi P Beta-Binomial, diterapkan ke board 198 baris.
// Deterministik; tanpa Date/random. Hasilnya direplikasi persis oleh
// build script T2.5 (pool v6 $1.114.005.922, range 66/92 = 71,7%).

import type { Snapshot } from './board5.ts';
import type { BoardRow } from './board5.ts';
import {
  buildComps, computeStats, designMatrix, designRow, ridgeFit, predictOne,
  pressLoo, missFromLogResiduals, medianMiss, selectLambda, quantile,
  calibrateP, ageDaysV6,
} from './ridge.ts';

export interface LooPred {
  slug: string;
  category: string | null;
  actual: number;
  pred: number;
  logResid: number;
  lambda: number;
}

export interface WfPred {
  slug: string;
  listed_at: string | null;
  actual: number;
  pred: number;
  logResid: number;
  lambda: number;
  fold: number;
}

export interface BoardV6Row {
  slug: string;
  category: string | null;
  tvl_usd: number;
  V6: number;
  P6: number;
  p_level: string;
  implied6: number;
}

export interface LargestError {
  slug: string;
  category: string | null;
  actual_mcap_per_tvl: number;
  pred_mcap_per_tvl: number;
  factor: number;
}

export interface RefitResult {
  lambda_penalty: number;
  lambda_loo_miss_full: number;
  loo_miss_geomean: number;
  loo_miss_median: number;
  wf_miss_geomean: number;
  wf_miss_median: number;
  noise_floor_loo_geomean: number;
  noise_floor_loo_median: number;
  range_holds_pct: number;
  range_holds: number;
  range_n: number;
  top20_kept: number;
  top20_v5: string[];
  top20_v6: string[];
  total_implied_v6_usd: number;
  total_implied_v5_usd: number;
  verdicts_v6_default_plan: { FARM: number; MARGINAL: number; SKIP: number };
  verdicts_v5_default_plan: { FARM: number; MARGINAL: number; SKIP: number };
  largest_loo_errors: LargestError[];
  loo_predictions: { slug: string; category: string | null; actual_mcap_per_tvl: number; pred_mcap_per_tvl: number; lambda: number }[];
  wf_predictions: { slug: string; category: string | null | undefined; listed_at: string | null; fold: number; actual_mcap_per_tvl: number; pred_mcap_per_tvl: number; lambda: number }[];
  board_v6: BoardV6Row[];
  coefficients: {
    intercept: number;
    beta_cont: Record<string, number>;
    beta_cat: Record<string, number>;
    means: Record<string, number>;
    stds: Record<string, number>;
    cat_list: (string | null)[];
  };
  comps_n: number;
  wf_n: number;
  loo_n: number;
}

const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export function refitV6(snapshot: Snapshot, board: BoardRow[]): RefitResult {
  const { comps, attrition } = buildComps(snapshot);
  void attrition;
  const v5TotalImplied = board.reduce((a, r) => a + r.implied_value_usd, 0);

  // ---------- 1. Nested LOO ----------
  const looPreds: LooPred[] = [];
  for (let i = 0; i < comps.length; i++) {
    const held = comps[i]!;
    const train = comps.filter((_, j) => j !== i);
    const stats = computeStats(train);
    const { X, y } = designMatrix(train, stats);
    const { lambda } = selectLambda(X, y);
    const beta = ridgeFit(X, y, lambda);
    const pred = predictOne(designRow(held, stats), beta);
    const actual = Math.log(held.mcap_usd! / held.tvl_usd);
    looPreds.push({ slug: held.slug, category: held.category, actual, pred, logResid: actual - pred, lambda });
  }
  const looMiss = missFromLogResiduals(looPreds.map((p) => p.pred - p.actual))!;
  const looMed = medianMiss(looPreds.map((p) => p.pred - p.actual))!;

  // ---------- 1b. Dataset Noise Floor ----------
  const nfRes: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const m = train.reduce((a, p) => a + Math.log(p.mcap_usd! / p.tvl_usd), 0) / train.length;
    nfRes.push(m - Math.log(comps[i]!.mcap_usd! / comps[i]!.tvl_usd));
  }
  const nfGeo = missFromLogResiduals(nfRes)!;
  const nfMed = medianMiss(nfRes)!;

  // ---------- 2. Walk-Forward expanding window ----------
  const dated = comps.filter((p) => p.listed_at).sort((a, b) =>
    a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : 1);
  const NB = 5;
  const base = Math.floor(dated.length / NB);
  const rem = dated.length % NB;
  const blocks: typeof dated[] = [];
  let off = 0;
  for (let b = 0; b < NB; b++) {
    const sz = base + (b < rem ? 1 : 0);
    blocks.push(dated.slice(off, off + sz));
    off += sz;
  }
  const wfPreds: WfPred[] = [];
  for (let k = 1; k < NB; k++) {
    const train = blocks.slice(0, k).flat();
    const test = blocks[k]!;
    const stats = computeStats(train);
    const { X, y } = designMatrix(train, stats);
    const { lambda } = selectLambda(X, y);
    const beta = ridgeFit(X, y, lambda);
    for (const p of test) {
      const pred = predictOne(designRow(p, stats), beta);
      const actual = Math.log(p.mcap_usd! / p.tvl_usd);
      wfPreds.push({ slug: p.slug, listed_at: p.listed_at, actual, pred, logResid: actual - pred, lambda, fold: k });
    }
  }
  const wfMiss = missFromLogResiduals(wfPreds.map((p) => p.pred - p.actual))!;
  const wfMed = medianMiss(wfPreds.map((p) => p.pred - p.actual))!;

  // ---------- 3. Range holds (kuantil LOO leave-one-out, per kategori) ----------
  let holds = 0;
  for (const p of looPreds) {
    let pool = looPreds.filter((q) => q.slug !== p.slug && q.category === p.category).map((q) => q.logResid);
    if (pool.length < 5) pool = looPreds.filter((q) => q.slug !== p.slug).map((q) => q.logResid);
    pool.sort((a, b) => a - b);
    const q10 = quantile(pool, 0.1);
    const q90 = quantile(pool, 0.9);
    const low = p.pred + q10;
    const high = p.pred + q90;
    if (p.actual >= low && p.actual <= high) holds++;
  }
  const rangeHolds = holds / looPreds.length;

  // ---------- 4. Final fit (semua comps) + terapkan ke board 198 ----------
  const statsFull = computeStats(comps);
  const { X: Xf, y: yf } = designMatrix(comps, statsFull);
  const { lambda: lambdaFinal, miss: lambdaLooMiss } = selectLambda(Xf, yf);
  const betaFull = ridgeFit(Xf, yf, lambdaFinal);
  const pCal = calibrateP(snapshot);
  const boardOut: BoardV6Row[] = [];
  for (const r of board) {
    const pred = predictOne(designRow(r, statsFull), betaFull);
    const V6 = Math.max(1, r.tvl_usd * Math.exp(pred));
    const { p: P6, level } = pCal.pFor(r);
    const implied6 = Math.max(1, Math.round(V6 * P6));
    boardOut.push({ slug: r.slug, category: r.category, tvl_usd: r.tvl_usd, V6: Math.round(V6), P6: +P6.toFixed(4), p_level: level, implied6 });
  }
  const totalImplied6 = boardOut.reduce((a, r) => a + r.implied6, 0);
  const top20v5 = [...board].sort((a, b) => b.implied_value_usd - a.implied_value_usd).slice(0, 20).map((r) => r.slug);
  const top20v6 = [...boardOut].sort((a, b) => b.implied6 - a.implied6).slice(0, 20).map((r) => r.slug);
  const top20kept = top20v5.filter((s) => top20v6.includes(s)).length;

  // Verdict v6 pada default plan ($1000 / 7%).
  const verdicts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  const D = 1000;
  const s = 0.07;
  for (const r of board) {
    const o = boardOut.find((x) => x.slug === r.slug)!;
    const net = (s * o.implied6 * D) / r.tvl_usd - r.fees_usd;
    const be = Math.min(1, Math.max(0, r.fees_usd / ((s * o.V6 * D) / r.tvl_usd)));
    const v = net >= 5 && o.P6 >= 2 * be ? 'FARM' : net >= 0 && o.P6 >= be ? 'MARGINAL' : 'SKIP';
    verdicts[v]++;
  }

  // 5 error LOO terbesar (untuk panel backtest).
  const largestErrors: LargestError[] = [...looPreds]
    .sort((a, b) => Math.abs(b.logResid) - Math.abs(a.logResid))
    .slice(0, 5)
    .map((p) => ({ slug: p.slug, category: p.category, actual_mcap_per_tvl: +Math.exp(p.actual).toFixed(4), pred_mcap_per_tvl: +Math.exp(p.pred).toFixed(4), factor: +Math.exp(Math.abs(p.logResid)).toFixed(2) }));

  // Koefisien final (skala terstandardisasi + dummy kategori).
  const cont = statsFull.cont;
  const betaCont: Record<string, number> = {};
  cont.forEach((k, idx) => { betaCont[k] = betaFull[1 + idx]!; });
  const betaCat: Record<string, number> = {};
  statsFull.catList.forEach((c, idx) => { betaCat[c as string] = betaFull[1 + cont.length + idx]!; });

  return {
    lambda_penalty: lambdaFinal,
    lambda_loo_miss_full: +lambdaLooMiss.toFixed(4),
    loo_miss_geomean: +looMiss.toFixed(4),
    loo_miss_median: +looMed.toFixed(4),
    wf_miss_geomean: +wfMiss.toFixed(4),
    wf_miss_median: +wfMed.toFixed(4),
    noise_floor_loo_geomean: +nfGeo.toFixed(4),
    noise_floor_loo_median: +nfMed.toFixed(4),
    range_holds_pct: +(rangeHolds * 100).toFixed(1),
    range_holds: holds,
    range_n: looPreds.length,
    top20_kept: top20kept,
    top20_v5: top20v5,
    top20_v6: top20v6,
    total_implied_v6_usd: totalImplied6,
    total_implied_v5_usd: v5TotalImplied,
    verdicts_v6_default_plan: verdicts,
    verdicts_v5_default_plan: { FARM: 63, MARGINAL: 52, SKIP: 83 },
    largest_loo_errors: largestErrors,
    loo_predictions: looPreds.map((p) => ({ slug: p.slug, category: p.category, actual_mcap_per_tvl: +Math.exp(p.actual).toFixed(4), pred_mcap_per_tvl: +Math.exp(p.pred).toFixed(4), lambda: p.lambda })),
    wf_predictions: wfPreds.map((p) => ({ slug: p.slug, category: comps.find((c) => c.slug === p.slug)?.category, listed_at: p.listed_at, fold: p.fold, actual_mcap_per_tvl: +Math.exp(p.actual).toFixed(4), pred_mcap_per_tvl: +Math.exp(p.pred).toFixed(4), lambda: p.lambda })),
    board_v6: boardOut,
    coefficients: {
      intercept: betaFull[0]!,
      beta_cont: betaCont,
      beta_cat: betaCat,
      means: statsFull.means,
      stds: statsFull.stds,
      cat_list: statsFull.catList,
    },
    comps_n: comps.length,
    wf_n: wfPreds.length,
    loo_n: looPreds.length,
  };
}

export { r4, ageDaysV6 };
