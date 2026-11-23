// Token Radar v6.2 entrypoint (Node 22, standard library only).
//
// Hybrid v5 Core + v6 Visual (BLUEPRINT §15):
// - Peringkat board + verdict + urutan tampil memakai point-estimate v5
//   (implied = valueIfLaunches x P(launch)); dashboard mengurutkan default
//   by net v5 @ $1.000 menurun, jadi 12 baris teratas semuanya FARM positif.
// - Interval P10–P90 + kalibrasi memakai model v6 (Ridge log-linear
//   ln(FDV/TVL), lambda=10, kalibrasi P Beta-Binomial) — interval v6 hanya
//   tampil di Detail View, TIDAK PERNAH di tabel utama.
// - Keduanya dihitung live dari snapshot yang disegel di tiap run — tidak
//   ada daftar nama yang di-hardcode.
//
// Membaca /input/snapshot.json, menulis /output/board.json (198 baris),
// /output/data.json (payload yang dimuat dashboard via fetch('../data.json')),
// menyalin dashboard/ + screenshots/ repo ke /output, dan menulis
// /output/dossier.json dengan library vendor make.fun.
//
// Di luar container grader, MAKEFUN_OUTPUT_DIR menggantikan /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildBoard, parseSnapshot } from './lib/board5.ts';
import { refitV6 } from './lib/refit6.ts';
import { buildDataPayload } from './lib/payload.ts';
import { buildAnchors } from './lib/anchors.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Cap scorer (reference/gate.json): cap teks membentuk byte, sisanya menolak. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> dari argumen, atau fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar v6.2: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board } = buildBoard(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar v6.2: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

// Refit v6 live dari snapshot yang sama, lalu rakit payload dashboard.
// buildDataPayload gagal keras bila angka replikasi tidak cocok dengan
// nilai beku (pool v6/v5, verdict 61/45/92 dan 63/52/83, range 66/92,
// farm_steps 1.188, board sha).
const refit = refitV6(snapshot, board);
const { payload, verification } = buildDataPayload(snapshot, board, refit);

// Anchors + komposisi + cohort + validasi v5 beku (verifikasi vs v5 di dalam).
const anchors = buildAnchors(snapshot, board);
const fullPayload = {
  ...payload,
  meta: {
    ...payload.meta,
    model: 'token-radar-v6.2 (hybrid: ranking+verdict v5, intervals v6)',
    generatedBy: 'main.ts (token-radar-v6.2, deterministik)',
  },
  composition: anchors.composition,
  live: anchors.live,
  cohort: anchors.cohort,
  v5val: anchors.v5val,
};

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.json'), JSON.stringify(fullPayload));

/** Salin file reguler satu direktori ke `to`, lewati nama berawalan titik. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
if (dashFiles.length !== 3) {
  process.stderr.write(`token radar v6.2: dashboard/ holds ${dashFiles.length} files, expected exactly 3 (index.html, styles.css, app.js) for the 65,536-byte dossier cap\n`);
  process.exit(1);
}
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar v6.2: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar v6.2: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// Dossier ditulis terakhir: scorer membangun ulang dari /output ini dan membandingkan byte.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }));

process.stdout.write(
  `token radar v6.2 (hybrid v5 core + v6 intervals): ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows ranked\n` +
    `token radar v6.2: total implied v6 $${verification.total_implied_v6_usd} (v5 $${verification.total_implied_v5_usd}); verdicts v6 ${JSON.stringify(verification.verdicts_v6_default_1000_7pct)}; verdicts v5 ${JSON.stringify(verification.verdicts_v5_default_1000_7pct)}\n` +
    `token radar v6.2: LOO miss median x${refit.loo_miss_median} (geomean x${refit.loo_miss_geomean}); walk-forward median x${refit.wf_miss_median}; range holds ${verification.range_holds_replicated}; top-20 kept ${refit.top20_kept}/20; lambda ${refit.lambda_penalty}\n` +
    `token radar v6.2: composition ${JSON.stringify(anchors.composition)}; traded anchors with mcap ${anchors.live.length}; cohort cells ${anchors.cohort.cells.length}\n` +
    `token radar v6.2: wrote ${join(out, 'board.json')}, ${join(out, 'data.json')}, ${join(out, 'dashboard')} (${dashFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
