# Token Radar v6.2

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/DullVentura/token-radar-v62/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/DullVentura/token-radar-v62/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Hybrid multi-file token launch radar for make.fun competition `token-radar-01` — **v5 core + v6 calibration** (BLUEPRINT §15).

- **Ranking + verdict + default order:** point-estimate v5 — implied = valueIfLaunches × P(launch | age, category); the board sorts by net v5 @ $1,000 descending, so the top 12 rows are all FARM-positive (Manifest Trade +$27,07 … Apex Omni +$15,33).
- **Intervals:** model v6 — Ridge log-linear ln(FDV/TVL), λ=10, P calibrated by Empirical Bayes Beta-Binomial, P10–P90 from LOO residual quantiles per category. v6 ranges appear **only in the Detail View, in dollars, with no ratio number** (the “×172 Wide” label is gone; a green Tight badge shows only when the v6 interval ratio ≤ ×10).
- **Dashboard:** multi-file (`dashboard/index.html` + `styles.css` + `app.js` ≤ 65.536 dossier cap), `data.json` at output root, 7-metric KPI strip, dense 30px rows (Title + KPI + filter + 12 FARM rows fit 1024×640), Evidence panel below the table (v5-vs-v6 integrity bars, v5 ablation, 416 traded anchors, 63 costed farm plans with $/hour, T1.5 table, LOO scatter, 5 largest errors).
- **Numbers (replicated live from the sealed snapshot every run):** pool v5 $1.273.129.188, pool v6 $1.114.005.922, verdicts v5 63/52/83, v6 61/45/92, range holds v6 66/92 = 71,7% (v5 49,5%), LOO median v5 ×3,29 / v6 ×3,44, Top-20 v5 17/20 / v6 15/20, watchlist 40/40, composition 758 = 198 ranked + 416 traded + 58 set aside.

Run: `mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json`
