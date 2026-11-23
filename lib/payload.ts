// Token Radar v6.1 — builder payload data.json untuk dashboard.
//
// Merakit data.json yang dimuat dashboard via fetch('../data.json'):
// 198 baris (peringkat v5 + interval/verdict v6), scatter LOO, band
// kuantil global, 5 error terbesar, tabel 13 eksperimen T1.5, dan strip
// validasi. Gagal keras bila angka replikasi tidak cocok dengan nilai beku
// (pool, verdict v6/v5, range holds, farm_steps).
//
// Tabel T1.5 adalah metadata eksperimen offline yang dibekukan di T1.5
// (13 varian winsorisasi/blend pada fold yang sama); dashboard menampilkannya
// sebagai bukti kejujuran, bukan sebagai angka yang dihitung ulang di run.
// Sha board/model di bawah adalah hash artefak sumber beku yang dikutip
// footer dashboard sebagai provenance.

import { createHash } from 'node:crypto';
import type { BoardRow, Snapshot } from './board5.ts';
import type { RefitResult } from './refit6.ts';
import { quantile } from './ridge.ts';

export const FROZEN_BOARD_SHA = 'fdaa5c1b59007935739c57a8afc1875c297795329e8f12aed1e052ef9aa97e47';
export const FROZEN_MODEL_SHA = '9c70943615f818e229cbe468035b08c049d36ab968c5dbf5745b4a2bc7d07574';

const r4 = (x: number): number => Math.round(x * 10000) / 10000;

function fail(msg: string): never {
  throw new Error('payload GAGAL: ' + msg);
}

export interface T15Experiment {
  variant: string;
  loo_geo: number;
  loo_med: number;
  wf_geo: number;
  wf_med: number;
  range_holds_pct: number;
  top20_kept: number;
  total_implied_v6_usd: number;
  lambda_final: number;
}

/** Tabel eksperimen T1.5 (22 Nov 07:03 WIB) — dibekukan, ditampilkan apa adanya. */
export const T15_EXPERIMENTS: T15Experiment[] = [
  { variant: 'V0-baseline-T1', loo_geo: 4.9013, loo_med: 3.4391, wf_geo: 5.778, wf_med: 4.1092, range_holds_pct: 71.7, top20_kept: 15, total_implied_v6_usd: 1114005922, lambda_final: 10 },
  { variant: 'W98-winsor-q02-q98', loo_geo: 4.7616, loo_med: 3.8996, wf_geo: 5.6442, wf_med: 4.1654, range_holds_pct: 70.7, top20_kept: 16, total_implied_v6_usd: 1097700928, lambda_final: 10 },
  { variant: 'W95-winsor-q05-q95', loo_geo: 4.797, loo_med: 3.8106, wf_geo: 5.6857, wf_med: 3.9555, range_holds_pct: 70.7, top20_kept: 17, total_implied_v6_usd: 1100772726, lambda_final: 10 },
  { variant: 'W90-winsor-q10-q90', loo_geo: 4.7742, loo_med: 3.8052, wf_geo: 5.6455, wf_med: 4.0343, range_holds_pct: 71.7, top20_kept: 17, total_implied_v6_usd: 1167357945, lambda_final: 10 },
  { variant: 'W99-winsor-q01-q99', loo_geo: 4.7825, loo_med: 3.7059, wf_geo: 5.7061, wf_med: 4.2079, range_holds_pct: 70.7, top20_kept: 15, total_implied_v6_usd: 1103845449, lambda_final: 10 },
  { variant: 'WU50-cap-atas-ln50', loo_geo: 4.7398, loo_med: 3.6129, wf_geo: 5.778, wf_med: 4.1092, range_holds_pct: 70.7, top20_kept: 15, total_implied_v6_usd: 1108556314, lambda_final: 10 },
  { variant: 'WU100-cap-atas-ln100', loo_geo: 4.8134, loo_med: 3.5607, wf_geo: 5.778, wf_med: 4.1092, range_holds_pct: 71.7, top20_kept: 15, total_implied_v6_usd: 1109364344, lambda_final: 10 },
  { variant: 'B50-blend-50-50', loo_geo: 5.0928, loo_med: 4.4052, wf_geo: 5.7694, wf_med: 4.0387, range_holds_pct: 69.6, top20_kept: 13, total_implied_v6_usd: 4221772989, lambda_final: 10 },
  { variant: 'B25-blend-25pct', loo_geo: 4.8953, loo_med: 3.9673, wf_geo: 5.6333, wf_med: 4.1297, range_holds_pct: 71.7, top20_kept: 14, total_implied_v6_usd: 1787894319, lambda_final: 10 },
  { variant: 'W95+B50', loo_geo: 5.1192, loo_med: 4.3142, wf_geo: 5.7007, wf_med: 3.9219, range_holds_pct: 69.6, top20_kept: 14, total_implied_v6_usd: 2668818933, lambda_final: 10 },
  { variant: 'W98+B50', loo_geo: 5.1124, loo_med: 4.0472, wf_geo: 5.7076, wf_med: 4.1413, range_holds_pct: 69.6, top20_kept: 13, total_implied_v6_usd: 2837717700, lambda_final: 10 },
  { variant: 'WU50+B25', loo_geo: 4.8068, loo_med: 4.0847, wf_geo: 5.6333, wf_med: 4.1297, range_holds_pct: 72.8, top20_kept: 15, total_implied_v6_usd: 1669918562, lambda_final: 10 },
  { variant: 'W99+B25', loo_geo: 4.8415, loo_med: 4.0472, wf_geo: 5.5756, wf_med: 4.1957, range_holds_pct: 72.8, top20_kept: 15, total_implied_v6_usd: 1652356413, lambda_final: 10 },
];

export const T15_CONCLUSION = 'Winsorisasi memperbaiki geomean miss sedikit (x4,74–4,81 vs x4,90) dan Top-20 (+1–2) tapi MEMPERBURUK median miss di semua level (x3,56–3,90 vs x3,44 baseline) — cap target latih mengompresi prediksi ke tengah sehingga error tipikal membesar. Blend median kategori merusak total implied (median ln(mcap/TVL) kategori tinggi → V membengkak 1,5–3,8x) dan menurunkan Top-20 (13–15). Target T1.5 (Top-20 ≥ 18/20 DAN Median LOO < x3,29) tidak tercapai oleh pendekatan apa pun di keluarga model ini; butuh sinyal/fitur baru (bukan polesan target). Range holds tetap > 68% di semua varian (69,6–72,8%) — bukan faktor pembatas.';
export const T15_SHIPPED = 'baseline-T1 (tanpa winsorisasi, tanpa blend) — DIPERTAHANKAN. Alasan: median LOO miss terbaik (x3,4391, terdekat dengan target < x3,29) dan total implied paling realistis; tidak ada varian yang mencapai target T1.5; winsorisasi memperbaiki geomean sedikit (+top-20) tapi memperburuk median miss; blend merusak total implied dan top-20. Jangan memaksakan angka.';
export const T15_ALTERNATIVE = 'W95-winsor-q05-q95: Top-20 17/20, LOO geo x4,797, WF geo x5,686, WF med x3,956, range 70,7% — lebih dekat ke target Top-20 tapi median LOO memburuk ke x3,8106. Bila pengguna mengutamakan Top-20 recall di atas median miss, varian ini kandidat pengganti (keputusan pengguna).';

export interface DataPayload {
  meta: Record<string, unknown>;
  val: Record<string, unknown>;
  rows: Record<string, unknown>[];
  loo: { slug: string; cat: string | null; act: number; pred: number; holds: boolean }[];
  bandQ10: number;
  bandQ90: number;
  errors: { slug: string; category: string | null; act: number; pred: number; factor: number }[];
  t15: { experiments: T15Experiment[]; conclusion: string; shipped: string; alternative: string };
  verdictsDefault: { v6: { FARM: number; MARGINAL: number; SKIP: number }; v5: { FARM: number; MARGINAL: number; SKIP: number } };
}

export function buildDataPayload(snapshot: Snapshot, board: BoardRow[], refit: RefitResult): { payload: DataPayload; boardShaLive: string; verification: Record<string, unknown> } {
  if (board.length !== 198) fail('board rows != 198: ' + board.length);
  const b6 = new Map(refit.board_v6.map((r) => [r.slug, r]));
  if (b6.size !== 198) fail('board_v6 != 198');

  // ---------- verifikasi angka (gagal keras bila tidak cocok) ----------
  const total6 = refit.board_v6.reduce((a, r) => a + r.implied6, 0);
  if (total6 !== 1114005922) fail('total implied6 mismatch: ' + total6);
  const total5 = board.reduce((a, r) => a + r.implied_value_usd, 0);
  if (total5 !== 1273129188) fail('total implied5 mismatch: ' + total5);
  if (total6 !== refit.total_implied_v6_usd) fail('total6 != refit.total_implied_v6_usd');
  if (total5 !== refit.total_implied_v5_usd) fail('total5 != refit.total_implied_v5_usd');

  for (let i = 0; i < 198; i++) {
    if (board[i]!.rank !== i + 1) fail('rank field bukan 1..198 berurutan pada index ' + i);
    if (i > 0 && board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) fail('board tidak terurut implied v5 menurun');
  }
  let fsTotal = 0;
  for (const r of board) {
    const fs = r.farm_steps;
    if (!Array.isArray(fs) || fs.length < 3 || fs.length > 12) fail('farm_steps count di luar 3-12: ' + r.slug);
    for (const s of fs) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) fail('farm_steps panjang di luar 20-600: ' + r.slug + ' (' + t.length + ')');
    }
    fsTotal += fs.length;
  }
  if (fsTotal !== 1188) fail('farm_steps total != 1188: ' + fsTotal);
  const wlCount = board.filter((r) => r.is_watchlist === true).length;
  if (wlCount !== 40) fail('watchlist != 40: ' + wlCount);

  // verdict v6 default D=1000 s=0.07 — aturan refit verbatim
  const verdict6Of = (r: BoardRow, o: { implied6: number; V6: number; P6: number }, D: number, s: number): string => {
    const net = (s * o.implied6 * D) / r.tvl_usd - r.fees_usd;
    const be = Math.min(1, Math.max(0, r.fees_usd / ((s * o.V6 * D) / r.tvl_usd)));
    return net >= 5 && o.P6 >= 2 * be ? 'FARM' : net >= 0 && o.P6 >= be ? 'MARGINAL' : 'SKIP';
  };
  const vc6 = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  for (const r of board) vc6[verdict6Of(r, b6.get(r.slug)!, 1000, 0.07) as 'FARM' | 'MARGINAL' | 'SKIP']++;
  const vd6 = refit.verdicts_v6_default_plan;
  if (vc6.FARM !== vd6.FARM || vc6.MARGINAL !== vd6.MARGINAL || vc6.SKIP !== vd6.SKIP) {
    fail('verdict v6 default mismatch: ' + JSON.stringify(vc6) + ' vs ' + JSON.stringify(vd6));
  }
  if (vc6.FARM !== 61 || vc6.MARGINAL !== 45 || vc6.SKIP !== 92) fail('verdict v6 beku != 61/45/92: ' + JSON.stringify(vc6));
  // verdict v5 (point-estimate) dengan aturan yang sama atas angka v5
  const verdict5Of = (r: BoardRow, D: number, s: number): string => {
    const net = (s * r.implied_value_usd * D) / r.tvl_usd - r.fees_usd;
    const be = Math.min(1, Math.max(0, r.fees_usd / ((s * r.value_if_launches * D) / r.tvl_usd)));
    return net >= 5 && r.launch_odds >= 2 * be ? 'FARM' : net >= 0 && r.launch_odds >= be ? 'MARGINAL' : 'SKIP';
  };
  const vc5 = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  let v5fieldMismatch = 0;
  for (const r of board) {
    const v = verdict5Of(r, 1000, 0.07);
    vc5[v as 'FARM' | 'MARGINAL' | 'SKIP']++;
    if (v !== r.verdict) v5fieldMismatch++;
  }
  const vd5 = refit.verdicts_v5_default_plan;
  if (vc5.FARM !== vd5.FARM || vc5.MARGINAL !== vd5.MARGINAL || vc5.SKIP !== vd5.SKIP) {
    fail('verdict v5 default mismatch: ' + JSON.stringify(vc5) + ' vs ' + JSON.stringify(vd5));
  }
  if (vc5.FARM !== 63 || vc5.MARGINAL !== 52 || vc5.SKIP !== 83) fail('verdict v5 beku != 63/52/83: ' + JSON.stringify(vc5));
  if (v5fieldMismatch !== 0) fail('aturan verdict v5 tidak mereproduksi field verdict board: ' + v5fieldMismatch + ' mismatch');

  // ---------- residual LOO -> kuantil per kategori + global ----------
  // Dipakai nilai LOO yang dibulatkan 4 desimal (sama seperti artefak refit),
  // supaya interval P10–P90 identik dengan build T2.5.
  const loo = refit.loo_predictions.map((p) => ({
    slug: p.slug,
    category: p.category,
    act: p.actual_mcap_per_tvl,
    pred: p.pred_mcap_per_tvl,
    lr: Math.log(p.actual_mcap_per_tvl) - Math.log(p.pred_mcap_per_tvl),
  }));
  const globalPool = loo.map((p) => p.lr).sort((a, b) => a - b);
  const bandQ10 = quantile(globalPool, 0.1);
  const bandQ90 = quantile(globalPool, 0.9);
  const poolFor = (cat: string | null, excludeSlug: string): number[] => {
    let pool = loo.filter((q) => q.slug !== excludeSlug && q.category === cat).map((q) => q.lr).sort((a, b) => a - b);
    if (pool.length < 5) pool = loo.filter((q) => q.slug !== excludeSlug).map((q) => q.lr).sort((a, b) => a - b);
    return pool;
  };
  let holds = 0;
  const looOut = loo.map((p) => {
    const pool = poolFor(p.category, p.slug);
    const q10 = quantile(pool, 0.1);
    const q90 = quantile(pool, 0.9);
    const predLn = Math.log(p.pred);
    const actLn = Math.log(p.act);
    const ok = actLn >= predLn + q10 && actLn <= predLn + q90;
    if (ok) holds++;
    return { slug: p.slug, cat: p.category, act: p.act, pred: p.pred, holds: ok };
  });
  if (holds !== 66) fail('range holds replication mismatch: ' + holds + ' (expect 66)');
  const rangePct = +(holds / loo.length * 100).toFixed(1);
  if (rangePct !== refit.range_holds_pct) fail('range pct mismatch');
  if (rangePct !== 71.7) fail('range pct beku != 71.7: ' + rangePct);

  // ---------- baris data.json ----------
  const rows = board.map((r) => {
    const o = b6.get(r.slug)!;
    const pool = poolFor(r.category, r.slug);
    const q10 = quantile(pool, 0.1);
    const q90 = quantile(pool, 0.9);
    const impLo = Math.max(1, Math.round(o.V6 * Math.exp(q10) * o.P6));
    const impHi = Math.max(1, Math.round(o.V6 * Math.exp(q90) * o.P6));
    const m = r.model || {};
    return {
      r: r.rank, s: r.slug, n: r.name, c: r.category, ch: r.chains,
      tvl: r.tvl_usd, g7: r.change_7d, age: r.age_days, st: r.token_status, wl: r.is_watchlist === true,
      i5: r.implied_value_usd, p5: r.launch_odds, v5: r.value_if_launches,
      l5: r.p10_usd, h5: r.p90_usd,
      m5: [r4(m.category_comp), r4(m.powerlaw_ratio), r4(m.blended_comp), r4(m.growth_multiplier), r4(m.drawdown_penalty)],
      v6: o.V6, p6: o.P6, pl: o.p_level, i6: o.implied6, lo: impLo, hi: impHi,
      fee: r.fees_usd, fs: r.farm_steps,
    };
  });

  const boardJsonText = `${JSON.stringify({ rows: board })}\n`;
  const boardShaLive = createHash('sha256').update(boardJsonText, 'utf8').digest('hex');
  if (boardShaLive !== FROZEN_BOARD_SHA) fail('board sha live != frozen board sha: ' + boardShaLive);

  const payload: DataPayload = {
    meta: {
      model: 'token-radar-v6.1 (hybrid: ranking v5, interval+verdict v6)',
      cutoff: snapshot.as_of,
      lambda: refit.lambda_penalty,
      boardRows: 198,
      boardSha: boardShaLive,
      modelSha: FROZEN_MODEL_SHA,
      total6,
      total5,
      watchlist: wlCount,
      generatedBy: 'main.ts (token-radar-v6.1, deterministik)',
    },
    val: {
      looMed: refit.loo_miss_median,
      looGeo: refit.loo_miss_geomean,
      looN: refit.loo_n,
      wfMed: refit.wf_miss_median,
      wfGeo: refit.wf_miss_geomean,
      wfN: refit.wf_n,
      nfGeo: refit.noise_floor_loo_geomean,
      nfMed: refit.noise_floor_loo_median,
      range: refit.range_holds_pct,
      rangeN: refit.range_n,
      rangeHolds: holds,
      top20: refit.top20_kept,
      v5: { looMed: 3.29, wfMed: 4.06, range: 49.5, top20: 17 },
    },
    rows,
    loo: looOut,
    bandQ10: +bandQ10.toFixed(4),
    bandQ90: +bandQ90.toFixed(4),
    errors: refit.largest_loo_errors.map((e) => ({
      slug: e.slug, category: e.category, act: e.actual_mcap_per_tvl,
      pred: e.pred_mcap_per_tvl, factor: e.factor,
    })),
    t15: {
      experiments: T15_EXPERIMENTS,
      conclusion: T15_CONCLUSION,
      shipped: T15_SHIPPED,
      alternative: T15_ALTERNATIVE,
    },
    verdictsDefault: { v6: vd6, v5: vd5 },
  };

  return {
    payload,
    boardShaLive,
    verification: {
      rows: 198,
      total_implied_v6_usd: total6,
      total_implied_v5_usd: total5,
      verdicts_v6_default_1000_7pct: vc6,
      verdicts_v5_default_1000_7pct: vc5,
      v5_field_mismatches: v5fieldMismatch,
      range_holds_replicated: holds + '/92 = ' + rangePct + '%',
      watchlist_covered: wlCount + '/40',
      farm_steps_total: fsTotal,
      board_sha256_live: boardShaLive,
    },
  };
}
