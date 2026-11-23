// Token Radar v6.2 — traded anchors, composition & frozen v5 validation.
//
// Dihitung LIVE dari snapshot yang disegel di tiap run: komposisi board
// (758 dibaca, 198 diranking, 416 sudah trade, 58 disisihkan dengan alasan),
// daftar traded anchors (protokol yang mencatat token DAN membawa market
// cap), dan cohort fit di balik launch odds. Blok validasi v5 (ablation,
// power law, refit stability) adalah metadata BEKU yang disalin dari
// data.js entry v5 sendiri (board sha fdaa5c1b59007935739c57a8afc1875c297795329e8f12aed1e052ef9aa97e47)
// — dilabeli v5 di mana pun ditampilkan, tidak pernah disajikan sebagai
// hasil hitung ulang run ini. Pola yang sama dipakai payload.ts untuk tabel
// eksperimen T1.5.

import { exclusionReason, fitCohort, hasToken } from './board5.ts';
import type { BoardRow, CohortFit, Snapshot } from './board5.ts';

export interface TradedAnchor {
  s: string;
  n: string;
  c: string | null;
  tvl: number;
  mcap: number;
  ratio: number;
}

export interface Composition {
  total: number;
  ranked: number;
  traded: number;
  bridge: number;
  staking: number;
  cex: number;
  versioned: number;
  wrapped: number;
  exchange: number;
  setAside: number;
}

/** Komposisi beku v5 (data.js entry v5) — dipakai sebagai verifikasi. */
export const FROZEN_COMPOSITION: Composition = {
  total: 758, ranked: 198, traded: 416, bridge: 43, staking: 43,
  cex: 42, versioned: 11, wrapped: 5, exchange: 0, setAside: 58,
};

/**
 * Validasi v5 (BEKU — dari data.js entry v5, bukan hitung ulang run ini).
 * LOO n=95, walk-forward n=48, 200 bootstrap refits, power law atas 95 comps.
 */
export const V5_VALIDATION = {
  provenance: 'v5 entry data.js (board sha fdaa5c1b…97e47) — frozen, labelled v5 wherever shown',
  fit_n: 95,
  loo: { n: 95, median_miss: 3.29, within_2x_pct: 29.5, within_3x_pct: 46.3, spearman: 0.3416 },
  walk_forward: { n: 48, median_miss: 4.06, within_2x_pct: 27.1, within_3x_pct: 37.5, spearman: 0.3097 },
  ablation: [
    { term: 'Flat global median multiple', loo_miss: 4.89, within_3x_pct: 37.9, spearman: 0.4001 },
    { term: '+ size curve (power law)', loo_miss: 3.08, within_3x_pct: 49.5, spearman: 0.3538 },
    { term: '+ category comps blend', loo_miss: 3.2, within_3x_pct: 45.3, spearman: 0.3406 },
    { term: '+ 7-day growth carry', loo_miss: 3.29, within_3x_pct: 47.4, spearman: 0.3403 },
    { term: 'Full: + drawdown penalty', loo_miss: 3.29, within_3x_pct: 46.3, spearman: 0.3416 },
  ],
  range: { q10: -2.5435, q25: -1.2871, q75: 1.0504, q90: 2.0918, holds_pct: 49.5 },
  refits: { count: 200, top20_kept: 17, threshold_pct: 80 },
  powerlaw: { intercept: 3.5291, slope: 0.4567, r_squared: 0.1676, n: 95 },
  global_median: 0.2042,
};

function fail(msg: string): never {
  throw new Error('anchors GAGAL: ' + msg);
}

export interface Anchors {
  composition: Composition;
  live: TradedAnchor[];
  cohort: CohortFit;
  v5val: typeof V5_VALIDATION;
}

export function buildAnchors(snapshot: Snapshot, board: BoardRow[]): Anchors {
  if (board.length !== 198) fail('board rows != 198: ' + board.length);

  // ---------- komposisi (dihitung live, diverifikasi vs beku v5) ----------
  let traded = 0;
  const aside = { bridge: 0, staking: 0, cex: 0, versioned: 0, wrapped: 0, exchange: 0 };
  for (const p of snapshot.protocols) {
    if (hasToken(p)) { traded++; continue; }
    const r = exclusionReason(p);
    if (r === 'Bridge') aside.bridge++;
    else if (r === 'Liquid staking / restaking') aside.staking++;
    else if (r === 'Centralised exchange') aside.cex++;
    else if (r === 'Versioned pool') aside.versioned++;
    else if (r === 'Wrapped / staked asset') aside.wrapped++;
    else if (r === 'Exchange-branded product') aside.exchange++;
  }
  // "Set aside" di komposisi v5 = bucket Other (CEX + versioned + wrapped +
  // exchange-branded) = 58; bridge (43) dan staking (43) punya segmen sendiri
  // di coverage bar. Total yang disisihkan = 58 + 43 + 43 = 144.
  const setAside = aside.cex + aside.versioned + aside.wrapped + aside.exchange;
  const composition: Composition = {
    total: snapshot.protocols.length,
    ranked: board.length,
    traded,
    ...aside,
    setAside,
  };
  const f = FROZEN_COMPOSITION;
  for (const k of Object.keys(f) as (keyof Composition)[]) {
    if (composition[k] !== f[k]) fail(`composition.${k} live ${composition[k]} != beku v5 ${f[k]}`);
  }

  // ---------- traded anchors: token sudah trade + market cap tercatat ----------
  const live: TradedAnchor[] = [];
  for (const p of snapshot.protocols) {
    if (!hasToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    live.push({
      s: p.slug, n: p.name, c: p.category, tvl: p.tvl_usd,
      mcap: p.mcap_usd, ratio: +(p.mcap_usd / p.tvl_usd).toFixed(4),
    });
  }
  live.sort((a, b) => b.mcap - a.mcap);
  if (live.length < 100) fail('traded anchors dengan mcap < 100: ' + live.length);

  // ---------- cohort fit (dasar launch odds) ----------
  const cohort = fitCohort(snapshot.protocols, snapshot.as_of);
  if (cohort.global_traded !== traded) fail('cohort global_traded != traded');

  return { composition, live, cohort, v5val: V5_VALIDATION };
}
