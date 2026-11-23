// Token Radar v6.2 — dashboard app. Static, fetch data.json relatif.
// Peringkat + verdict + urutan default = model v5 (net @ deposit menurun).
// Interval P10–P90 model v6 HANYA tampil di Detail View (dalam dolar, tanpa
// angka rasio). Badge "Tight" hanya bila rasio interval v6 <= x10; rasio
// lebar tidak pernah ditampilkan sebagai angka.
// Rumus beku: net = s * implied * D / TVL - fees. $/hour = net / jam kerja
// (jumlah "Time:" di farm plan; langkah mingguan x 12 minggu; langkah hold
// tanpa Time: = 0 menit kerja).
(function () {
  'use strict';
  var D = 1000, S = 0.07;
  var DATA = null, rows = [], VAL = null, COMP = null, LIVE = [], COHORT = null, V5VAL = null;
  var DEPS = [250, 1000, 10000], SHARES = [0.035, 0.07, 0.14];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtUSD(v) {
    var neg = v < 0, a = Math.abs(v), s;
    if (a >= 1e9) s = '$' + (a / 1e9).toFixed(2) + 'B';
    else if (a >= 1e6) s = '$' + (a / 1e6).toFixed(2) + 'M';
    else if (a >= 1e3) s = '$' + (a / 1e3).toFixed(2) + 'K';
    else s = '$' + a.toFixed(2);
    return (neg ? '-' : '') + s;
  }
  function fmtUSD2(v) {
    var neg = v < 0;
    var s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (neg ? '-$' : '$') + s;
  }
  function fmtMoney(v) {
    if (v == null || !isFinite(v)) return 'n/a';
    var neg = v < 0;
    return (neg ? '-' : '') + '$' + Math.abs(Math.round(v)).toLocaleString('en-US');
  }
  function fmtInt(v) { return v == null ? '—' : Math.round(v).toLocaleString('en-US'); }
  function fmtPct(x) { return (x * 100).toFixed(1) + '%'; }
  function fmtPct1(x) { return x == null ? '—' : (x > 0 ? '+' : '') + x.toFixed(1) + '%'; }
  function fmtX(v) { return '×' + v.toFixed(2); }
  function fmtAge(d) {
    if (d == null) return '—';
    if (d < 30) return d + 'd';
    if (d < 365) return (d / 30).toFixed(0) + 'mo';
    return (d / 365).toFixed(1) + 'y';
  }
  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
  function addDays(dateStr, days) {
    var d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  // ---- model per baris: v5 primer, v6 sekunder ----
  function net5(r) { return S * r.i5 * D / r.tvl - r.fee; }
  function be5(r) {
    var denom = (S * r.v5 * D) / r.tvl;
    return Math.min(1, Math.max(0, denom > 0 ? r.fee / denom : 1));
  }
  function verdict5(r) {
    var n = net5(r), be = be5(r);
    if (n >= 5 && r.p5 >= 2 * be) return 'FARM';
    if (n >= 0 && r.p5 >= be) return 'MARGINAL';
    return 'SKIP';
  }
  function net6(r) { return S * r.i6 * D / r.tvl - r.fee; }
  function net6Lo(r) { return S * r.lo * D / r.tvl - r.fee; }
  function net6Hi(r) { return S * r.hi * D / r.tvl - r.fee; }
  function be6(r) {
    var denom = (S * r.v6 * D) / r.tvl;
    return Math.min(1, Math.max(0, denom > 0 ? r.fee / denom : 1));
  }
  function verdict6(r) {
    var n = net6(r), be = be6(r);
    if (n >= 5 && r.p6 >= 2 * be) return 'FARM';
    if (n >= 0 && r.p6 >= be) return 'MARGINAL';
    return 'SKIP';
  }
  function conf6(r) { return r.hi / Math.max(1, r.lo); }
  function isTight(r) { return conf6(r) <= 10; }

  // ---- waktu kerja farm plan -> $/hour (jujur, dari teks langkah) ----
  var TIME_RE = /Time:\s*(\d+(?:\.\d+)?)\s*(minutes?|hours?)/i;
  function stepMinutes(s) {
    var m = TIME_RE.exec(s);
    if (!m) return 0;
    var v = parseFloat(m[1]) * (/hour/i.test(m[2]) ? 60 : 1);
    var tail = s.slice(m.index + m[0].length, m.index + m[0].length + 16);
    return /week/i.test(tail) ? v * 12 : v;
  }
  function rowMinutes(r) {
    var t = 0;
    for (var i = 0; i < r.fs.length; i++) t += stepMinutes(r.fs[i]);
    return t;
  }
  function usdPerHour(r, net) {
    var mins = rowMinutes(r);
    if (mins <= 0) return null;
    return net / (mins / 60);
  }
  function fmtTime(mins) {
    if (mins <= 0) return '—';
    var h = Math.floor(mins / 60), m = Math.round(mins % 60);
    return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
  }

  function computeAll() {
    return rows.map(function (r) {
      var n5 = net5(r);
      return { r: r, net: n5, verdict: verdict5(r), v6: verdict6(r), perHour: usdPerHour(r, n5), tight: isTight(r) };
    });
  }

  // ---- KPI Strip: 7 metrik jujur, masing-masing berlabel v5/v6 ----
  function kpi(label, prov, value, sub) {
    return '<div class="kpi"><div class="label">' + label + ' <span class="prov ' + prov + '">' + prov + '</span></div>' +
      '<div class="value num">' + value + '</div><div class="sub">' + sub + '</div></div>';
  }
  function renderKPIs() {
    var all = computeAll();
    var farm = all.filter(function (c) { return c.verdict === 'FARM'; });
    var h = '';
    h += kpi('Ranked', 'v5', String(rows.length), 'pre-token protocols');
    h += kpi('Implied value', 'v5', fmtUSD(DATA.meta.total5), 'board · v6 ' + fmtUSD(DATA.meta.total6));
    h += kpi('LOO miss', 'v5', fmtX(VAL.v5.looMed) + ' median', 'n=95 · v6 ' + fmtX(VAL.looMed));
    h += kpi('Walk-forward', 'v5', fmtX(VAL.v5.wfMed) + ' median', 'n=48 · v6 ' + fmtX(VAL.wfMed));
    h += kpi('Range holds', 'v6', VAL.range.toFixed(1).replace('.', ',') + '%', VAL.rangeHolds + '/' + VAL.rangeN + ' holds · v5 ' + VAL.v5.range.toFixed(1).replace('.', ',') + '%');
    h += kpi('Top-20 kept', 'v5', VAL.v5.top20 + '/20', '200 refits · v6 ' + VAL.top20 + '/20');
    h += kpi('Farmable', 'v5', String(farm.length), '$' + D.toLocaleString('en-US') + ' / ' + (S * 100).toFixed(1).replace('.', ',') + '% · v6 ' + all.filter(function (c) { return c.v6 === 'FARM'; }).length);
    $('kpis').innerHTML = h;
  }

  // ---- Coverage: 758 dibaca, 198 diranking, 416 trade, 58 disisihkan ----
  function renderCoverage() {
    var c = COMP;
    function seg(n, cls, label) {
      if (n <= 0) return '';
      return '<span class="' + cls + '" style="width:' + (100 * n / c.total).toFixed(1) + '%">' + (n / c.total >= 0.06 ? esc(label) : '') + '</span>';
    }
    $('coverage').innerHTML =
      '<div class="comp">' + seg(c.ranked, 'c-ranked', 'Ranked ' + c.ranked) + seg(c.traded, 'c-traded', 'Already trade ' + c.traded) +
      seg(c.bridge, 'c-bridge', 'Bridge ' + c.bridge) + seg(c.staking, 'c-stake', 'Staking ' + c.staking) +
      seg(c.setAside, 'c-rest', 'Set aside ' + c.setAside) + '</div>' +
      '<div class="complegend"><span><b>' + c.total + '</b> read · <b>' + c.ranked + '</b> ranked (watchlist 40 + early) · <b>' + c.traded + '</b> traded as comparables · <b>' + c.bridge + '</b> bridge · <b>' + c.staking + '</b> staking · <b>' + c.cex + '</b> CEX · <b>' + c.versioned + '</b> versioned · <b>' + c.wrapped + '</b> wrapped · <b>' + c.exchange + '</b> exchange — set aside</span></div>';
  }

  // ---- Filter + sandbox ----
  var state = { scope: 'all', verdict: 'any', q: '', category: 'all', chain: 'all', sort: 'net', dir: -1 };
  function renderFilters() {
    var counts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
    for (var i = 0; i < rows.length; i++) counts[verdict5(rows[i])]++;
    var belowFloor = rows.filter(function (r) { return r.tvl < 50000000; }).length;
    var wl = rows.filter(function (r) { return r.wl; }).length;
    var cats = [];
    var seen = {};
    for (var j = 0; j < rows.length; j++) {
      var c = rows[j].c || 'Other';
      if (!seen[c]) { seen[c] = 1; cats.push(c); }
    }
    cats.sort();
    var chains = [];
    var seenCh = {};
    for (var k = 0; k < rows.length; k++) {
      for (var m = 0; m < rows[k].ch.length; m++) {
        var ch = rows[k].ch[m];
        if (!seenCh[ch]) { seenCh[ch] = 1; chains.push(ch); }
      }
    }
    chains.sort();
    function scopeBtn(v, label, n) {
      return '<button data-scope="' + v + '" class="' + (state.scope === v ? 'on' : '') + '">' + label + ' ' + n + '</button>';
    }
    function verdictBtn(v, label, n) {
      return '<button data-verdict="' + v + '" class="' + (state.verdict === v ? 'on' : '') + '">' + label + ' ' + n + '</button>';
    }
    $('filters').innerHTML =
      '<div class="frow">' + scopeBtn('all', 'All', rows.length) + scopeBtn('watchlist', 'Watchlist', wl) +
      scopeBtn('offlist', 'Off list', rows.length - wl) + scopeBtn('belowfloor', 'Below floor', belowFloor) +
      '<span class="lbl">Verdict</span>' + verdictBtn('any', 'Any', rows.length) + verdictBtn('FARM', 'Farm', counts.FARM) +
      verdictBtn('MARGINAL', 'Marginal', counts.MARGINAL) + verdictBtn('SKIP', 'Skip', counts.SKIP) + '</div>' +
      '<div class="frow"><span class="lbl">Deposit</span><select id="f-deposit"><option value="250"' + (D === 250 ? ' selected' : '') + '>$250</option><option value="1000"' + (D === 1000 ? ' selected' : '') + '>$1,000</option><option value="10000"' + (D === 10000 ? ' selected' : '') + '>$10,000</option></select>' +
      '<span class="lbl">Drop share</span><select id="f-share"><option value="0.035"' + (S === 0.035 ? ' selected' : '') + '>3.5%</option><option value="0.07"' + (S === 0.07 ? ' selected' : '') + '>7%</option><option value="0.14"' + (S === 0.14 ? ' selected' : '') + '>14%</option></select>' +
      '<input id="f-q" type="search" placeholder="Search name / slug / category" value="' + esc(state.q) + '">' +
      '<select id="f-cat"><option value="all">All categories</option>' + cats.map(function (x) { return '<option value="' + esc(x) + '"' + (state.category === x ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>' +
      '<select id="f-chain"><option value="all">All chains</option>' + chains.map(function (x) { return '<option value="' + esc(x) + '"' + (state.chain === x ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>' +
      '<button id="f-reset">Reset</button></div>';
    bindFilters();
  }
  function bindFilters() {
    var btns = document.querySelectorAll('#filters [data-scope]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function (e) { state.scope = e.currentTarget.getAttribute('data-scope'); refresh(); });
    }
    var vbtns = document.querySelectorAll('#filters [data-verdict]');
    for (var j = 0; j < vbtns.length; j++) {
      vbtns[j].addEventListener('click', function (e) { state.verdict = e.currentTarget.getAttribute('data-verdict'); refresh(); });
    }
    var dep = $('f-deposit');
    if (dep) dep.addEventListener('change', function (e) { D = Number(e.target.value); refresh(); });
    var sh = $('f-share');
    if (sh) sh.addEventListener('change', function (e) { S = Number(e.target.value); refresh(); });
    var q = $('f-q');
    if (q) q.addEventListener('input', function (e) {
      state.q = e.target.value; renderTable();
      var nq = $('f-q');
      if (nq) { nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); }
    });
    var cat = $('f-cat');
    if (cat) cat.addEventListener('change', function (e) { state.category = e.target.value; renderTable(); });
    var ch = $('f-chain');
    if (ch) ch.addEventListener('change', function (e) { state.chain = e.target.value; renderTable(); });
    var rs = $('f-reset');
    if (rs) rs.addEventListener('click', function () {
      state.scope = 'all'; state.verdict = 'any'; D = 1000; S = 0.07;
      state.q = ''; state.category = 'all'; state.chain = 'all'; state.sort = 'net'; state.dir = -1;
      refresh();
    });
  }

  // ---- Tabel utama: default = net v5 menurun (12 teratas semua FARM) ----
  var sortKey = 'net', sortDir = -1, selectedSlug = null;
  function valOf(c, k) {
    var r = c.r;
    switch (k) {
      case 'rank': return r.r;
      case 'name': return r.n.toLowerCase();
      case 'tvl': return r.tvl;
      case 'g7': return r.g7 == null ? -999 : r.g7;
      case 'age': return r.age == null ? -1 : r.age;
      case 'odds': return r.p5;
      case 'i5': return r.i5;
      case 'net': return c.net;
      case 'perhour': return c.perHour == null ? -999 : c.perHour;
      case 'be': return be5(r);
      case 'verdict': return { FARM: 0, MARGINAL: 1, SKIP: 2 }[c.verdict];
      default: return 0;
    }
  }
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var all = computeAll().filter(function (c) {
      var r = c.r;
      if (state.scope === 'watchlist' && !r.wl) return false;
      if (state.scope === 'offlist' && r.wl) return false;
      if (state.scope === 'belowfloor' && r.tvl >= 50000000) return false;
      if (state.verdict !== 'any' && c.verdict !== state.verdict) return false;
      if (state.category !== 'all' && (r.c || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && r.ch.indexOf(state.chain) < 0) return false;
      if (q && (r.n.toLowerCase().indexOf(q) < 0 && r.s.indexOf(q) < 0 && (r.c || '').toLowerCase().indexOf(q) < 0)) return false;
      return true;
    });
    all.sort(function (a, b) {
      var va = valOf(a, sortKey), vb = valOf(b, sortKey);
      if (va < vb) return -1 * sortDir;
      if (va > vb) return 1 * sortDir;
      return a.r.r - b.r.r;
    });
    return all;
  }
  function rangeBarHtml(r) {
    var lo = Math.log(Math.max(1, r.l5)), hi = Math.log(Math.max(1, r.h5)), mid = Math.log(Math.max(1, r.i5));
    var pos = hi > lo ? ((mid - lo) / (hi - lo)) * 100 : 50;
    return '<div class="rangebar" title="P10 ' + fmtUSD(r.l5) + ' – P90 ' + fmtUSD(r.h5) + ' (v5)"><i style="left:0%;width:100%"></i><b style="left:' + pos.toFixed(1) + '%"></b></div>';
  }
  function renderTable() {
    var all = filtered();
    var h = '';
    all.forEach(function (c) {
      var r = c.r;
      var netCls = c.net >= 0 ? 'pos' : 'neg';
      var phCls = (c.perHour == null || c.perHour < 0) ? 'neg' : 'pos';
      var chg = r.g7 == null ? '—' : fmtPct1(r.g7);
      var chgCls = r.g7 == null ? '' : (r.g7 >= 0 ? 'pos' : 'neg');
      var chTxt = r.ch[0] || '';
      var sel = r.s === selectedSlug ? ' selected' : '';
      h += '<tr class="clickable' + sel + '" data-slug="' + esc(r.s) + '"><td class="num">' + r.r + '</td>' +
        '<td class="name"><span class="ncell"><b>' + esc(r.n) + '</b>' + (r.wl ? ' <span class="tag wl">★ watchlist</span>' : '') + ' <span class="sub2">' + esc(r.c || 'Other') + ' · ' + esc(chTxt) + '</span></span></td>' +
        '<td class="num">' + fmtUSD(r.tvl) + '</td>' +
        '<td class="num ' + chgCls + '">' + chg + '</td>' +
        '<td class="num">' + fmtAge(r.age) + '</td>' +
        '<td class="num">' + Math.round(r.p5 * 100) + '%</td>' +
        '<td class="num"><b>' + fmtUSD(r.i5) + '</b>' + rangeBarHtml(r) + '</td>' +
        '<td class="num ' + netCls + '">' + fmtUSD2(c.net) + '</td>' +
        '<td class="num ' + phCls + '">' + (c.perHour == null ? '—' : fmtUSD2(c.perHour) + '/h') + '</td>' +
        '<td class="num">' + Math.round(be5(r) * 100) + '%</td>' +
        '<td><span class="verdict ' + c.verdict + '">' + c.verdict + '</span>' + (c.tight ? '<span class="tight">Tight</span>' : '') + '</td></tr>';
    });
    document.querySelector('#mainTable tbody').innerHTML = h;
    var counts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
    for (var i = 0; i < rows.length; i++) counts[verdict5(rows[i])]++;
    $('rowCount').textContent = 'Showing ' + all.length + ' of ' + rows.length + ' · $' + D.toLocaleString('en-US') + ' · ' + (S * 100).toFixed(1).replace('.', ',') + '% · ' +
      counts.FARM + ' Farm / ' + counts.MARGINAL + ' Marginal / ' + counts.SKIP + ' Skip (v5) · click a row for its derivation.';
    document.querySelectorAll('#mainTable th[data-k]').forEach(function (th) {
      var k = th.getAttribute('data-k');
      var arrow = sortKey === k ? (sortDir === 1 ? ' ▲' : ' ▼') : '';
      var label = th.textContent.replace(/ [▲▼]$/, '');
      th.textContent = label + arrow;
    });
  }

  // ---- Evidence panel (di bawah tabel, bukan di atas) ----
  function barRow(label, v6, v5, max, suffix) {
    var w6 = Math.max(2, Math.round(v6 / max * 100));
    var w5 = Math.max(2, Math.round(v5 / max * 100));
    return '<div class="bar-row"><div>' + label + '</div><div style="display:flex;flex-direction:column;gap:4px">' +
      '<div style="height:10px;background:#eef1f4;border-radius:999px;overflow:hidden"><div style="height:100%;width:' + w6 + '%;background:#0b5fff"></div></div>' +
      '<div style="height:10px;background:#eef1f4;border-radius:999px;overflow:hidden"><div style="height:100%;width:' + w5 + '%;background:#98a2b3"></div></div></div>' +
      '<div class="bar-vals num">v6 <b>' + v6 + suffix + '</b> · v5 ' + v5 + suffix + '</div></div>';
  }
  var ERR_NOTE = {
    'rain': 'Extreme outlier: realised FDV 400× TVL — far outside any comp range (median comp ≈0,3×). No feature can predict a 400× spike; this single row alone lifts the geomean miss. Predicted 0,42× vs actual 400,20× = 957,69×.',
    'concentrator': 'Token already listed with FDV/TVL near zero (0,0013×) — the model predicted the normal Yield-category ratio (0,32×). Over-predict 244×.',
    'bitway-earn': 'Realised FDV 36× TVL vs predicted 0,22× — under-predict 163×. Ratio far above the Basis Trading category median.',
    'flokifi-locker': 'Realised FDV 19× TVL vs predicted 0,25× — under-predict 76×.',
    'fables': 'Realised FDV 0,068× vs predicted 4,74× — over-predict 70×. Token listed with a small FDV relative to TVL.'
  };
  function nearestTraded(r) {
    var same = LIVE.filter(function (x) { return x.c === r.c && x.s !== r.s; });
    same.sort(function (a, b) {
      return Math.abs(Math.log(a.tvl / r.tvl)) - Math.abs(Math.log(b.tvl / r.tvl));
    });
    if (same.length) return same.slice(0, 3);
    var all = LIVE.slice().sort(function (a, b) {
      return Math.abs(Math.log(a.tvl / r.tvl)) - Math.abs(Math.log(b.tvl / r.tvl));
    });
    return all.slice(0, 3);
  }
  function renderEvidence() {
    var h = '';
    // Integrity: dua lapis berdampingan
    h += '<div class="card"><h3>Integrity strip — v5 vs v6, side by side (honest numbers)</h3><div class="bars">';
    h += barRow('LOO miss (median)', VAL.looMed.toFixed(2), VAL.v5.looMed.toFixed(2), 5, '×');
    h += barRow('WF miss (median)', VAL.wfMed.toFixed(2), VAL.v5.wfMed.toFixed(2), 5, '×');
    h += barRow('Range holds', VAL.range, VAL.v5.range, 100, '%');
    h += barRow('Top-20 kept', VAL.top20, VAL.v5.top20, 20, '/20');
    h += '</div><p class="legend"><span><i style="background:#0b5fff"></i>v6 (Ridge, λ=' + DATA.meta.lambda + ')</span><span><i style="background:#98a2b3"></i>v5 (heuristic geomean)</span></p>' +
      '<p class="small">LOO/WF miss: smaller is better. Range holds &amp; Top-20: bigger is better. v6 wins on interval calibration (range holds 71,7% vs 49,5%); v5 wins on miss median (LOO ×3,29 vs ×3,44; WF ×4,06 vs ×4,11) and Top-20 (17/20 vs 15/20). Nothing is hidden — the T1.5 target (median LOO &lt; ×3,29 AND Top-20 ≥ 18/20) was not reached by any variant; see the T1.5 table below.</p></div>';

    // Ablation v5 + kalibrasi range
    var ab = V5VAL.ablation.map(function (a) {
      return '<tr><td>' + esc(a.term) + '</td><td class="r num">×' + a.loo_miss.toFixed(2) + '</td><td class="r num">' + a.within_3x_pct + '%</td><td class="r num">' + a.spearman.toFixed(2) + '</td></tr>';
    }).join('');
    h += '<div class="evgrid"><div><div class="card"><h3>Ablation — each v5 term must earn its keep (blind test)</h3>' +
      '<table class="mini"><thead><tr><th>Model</th><th class="r">LOO miss</th><th class="r">Within 3×</th><th class="r">Rank ρ</th></tr></thead><tbody>' + ab + '</tbody></table>' +
      '<p class="small">The size curve does most of the work (×3,08 alone). The category blend (+0,12) and the growth carry (+0,09) cost a little blind-test miss — the table shows the cost instead of hiding it. Power law: log10(mcap) = ' + V5VAL.powerlaw.intercept + ' + ' + V5VAL.powerlaw.slope + ' × log10(TVL), R² = ' + V5VAL.powerlaw.r_squared + ', n=' + V5VAL.powerlaw.n + '. Refits: Top-20 kept ' + V5VAL.refits.top20_kept + '/20 in ≥' + V5VAL.refits.threshold_pct + '% of ' + V5VAL.refits.count + ' bootstrap refits. Range: P25–P75 holds ' + V5VAL.range.holds_pct + '% of held-out actuals (50% would be perfectly calibrated); the band is still wide — P90/P10 spans roughly 100× on a typical row. Treat every point estimate as the middle of a wide range, not a price.</p></div></div>';

    // Traded anchors
    var topFarm = computeAll().filter(function (c) { return c.verdict === 'FARM'; }).sort(function (a, b) { return b.net - a.net; }).slice(0, 5);
    var anchorRows = topFarm.map(function (c) {
      var a = nearestTraded(c.r)[0];
      return '<tr><td><b>' + esc(c.r.n) + '</b><br><span class="small">net ' + fmtUSD2(c.net) + ' · #' + c.r.r + ' v5</span></td><td>' + (a ? '<b>' + esc(a.n) + '</b><br><span class="small">' + esc(a.c || 'Other') + '</span>' : '—') + '</td><td class="r num">' + (a ? fmtUSD(a.tvl) : '—') + '</td><td class="r num">' + (a ? fmtUSD(a.mcap) : '—') + '</td><td class="r num">' + (a ? a.ratio.toFixed(2) + '×' : '—') + '</td></tr>';
    }).join('');
    h += '<div><div class="card"><h3>Traded anchors — token odds from the peers’ record</h3>' +
      '<p class="small"><b>' + COMP.traded + '</b> protocols already record a token — the comparables pool behind the launch odds (global cohort ' + COHORT.global_traded + '/' + COHORT.global_total + ' = ' + Math.round(COHORT.global_rate * 100) + '%). <b>' + LIVE.length + '</b> carry a recorded market cap; the nearest one anchors each top FARM row below.</p>' +
      '<table class="mini"><thead><tr><th>Top FARM row</th><th>Nearest traded anchor</th><th class="r">Anchor TVL</th><th class="r">Anchor mcap</th><th class="r">mcap/TVL</th></tr></thead><tbody>' + anchorRows + '</tbody></table>' +
      '<p class="small">Anchors are the closest traded token in the same category by TVL (log scale); when a category has none, the closest traded token overall is used. Launch odds themselves come from the (category, age) cohort — the share of protocols in that cohort that already record a token — shrunk (k=8) and clamped to 3–90%.</p></div></div></div>';

    // Costed farm plans (63 FARM) dengan $/hour
    var farm = computeAll().filter(function (c) { return c.verdict === 'FARM'; }).sort(function (a, b) { return (b.perHour || -999) - (a.perHour || -999); });
    var medPh = median(farm.map(function (c) { return c.perHour; }).filter(function (x) { return x != null; }));
    var planRows = farm.map(function (c) {
      return '<tr><td><b>' + esc(c.r.n) + '</b></td><td class="r num">' + fmtUSD2(c.net) + '</td><td class="r num">' + fmtTime(rowMinutes(c.r)) + '</td><td class="r num"><b>' + (c.perHour == null ? '—' : fmtUSD2(c.perHour) + '/h') + '</b></td></tr>';
    }).join('');
    h += '<div class="card"><h3>Costed farm plans — all ' + farm.length + ' FARM rows, with $/hour (active plan $' + D.toLocaleString('en-US') + ' × ' + (S * 100).toFixed(1).replace('.', ',') + '%)</h3>' +
      '<p class="small">Median ' + (medPh == null ? '—' : '<b>' + fmtUSD2(medPh) + '/h</b>') + ' across the ' + farm.length + ' FARM plans. $/hour = net ÷ hands-on time parsed from each plan’s own “Time:” lines (weekly steps × 12 weeks; the hold step carries no hands-on time). Time is work, not waiting — the 12-week horizon is the same one the fees assume.</p>' +
      '<div style="max-height:340px;overflow-y:auto"><table class="mini"><thead><tr><th>Protocol</th><th class="r">Net</th><th class="r">Hands-on time</th><th class="r">$/hour</th></tr></thead><tbody>' + planRows + '</tbody></table></div></div>';

    // Scatter LOO + 5 error terbesar + T1.5
    h += '<div class="card"><h3>LOO calibration — actual vs predicted (92 comps, log scale) <span class="prov v6">v6</span></h3><div class="svgwrap" id="scatterWrap"></div>' +
      '<p class="small">Green dot = actual inside the P10–P90 interval; red = outside. Dashed red = perfect prediction. Blue lines = global P10–P90 band (LOO residual quantiles). Axes in mcap/TVL (×TVL).</p>' +
      '<h3>5 largest LOO errors — and what explains them <span class="prov v6">v6</span></h3>' +
      '<div class="tablewrap"><table class="mini" id="errTable"><thead><tr><th>Protocol</th><th>Category</th><th class="r">Actual (×TVL)</th><th class="r">Predicted (×TVL)</th><th class="r">Error factor</th><th>Honest explanation</th></tr></thead><tbody></tbody></table></div>' +
      '<h3>T1.5 — 13 polish experiments (same folds) <span class="prov v6">v6</span></h3>' +
      '<div class="tablewrap"><table class="mini" id="t15Table"><thead><tr><th>Variant</th><th class="r">LOO med</th><th class="r">LOO geo</th><th class="r">WF med</th><th class="r">WF geo</th><th class="r">Range</th><th class="r">Top-20</th><th class="r">Total implied</th></tr></thead><tbody></tbody></table></div>' +
      '<p class="small" id="t15Conclusion"></p></div>';

    $('evidence').innerHTML = h;
    renderScatter();
    renderErrTable();
    renderT15();
  }
  function renderScatter() {
    var pts = DATA.loo;
    var xs = pts.map(function (p) { return Math.log(p.pred); });
    var ys = pts.map(function (p) { return Math.log(p.act); });
    var lo = Math.floor(Math.min.apply(null, xs.concat(ys)) - 0.5);
    var hi = Math.ceil(Math.max.apply(null, xs.concat(ys)) + 0.5);
    var W = 640, H = 380, PL = 56, PR = 16, PT = 14, PB = 44;
    var X = function (v) { return PL + (v - lo) / (hi - lo) * (W - PL - PR); };
    var Y = function (v) { return PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB); };
    var ticks = [];
    for (var t = -7; t <= 7; t++) { if (t >= lo && t <= hi) ticks.push(t); }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Scatter kalibrasi LOO">';
    ticks.forEach(function (t) {
      s += '<line class="grid" x1="' + X(t) + '" y1="' + PT + '" x2="' + X(t) + '" y2="' + (H - PB) + '"/>';
      s += '<line class="grid" x1="' + PL + '" y1="' + Y(t) + '" x2="' + (W - PR) + '" y2="' + Y(t) + '"/>';
      var lab = t === 0 ? '1×' : (t > 0 ? Math.round(Math.exp(t)) + '×' : '1/' + Math.round(Math.exp(-t)) + '×');
      s += '<text x="' + X(t) + '" y="' + (H - PB + 16) + '" text-anchor="middle">' + lab + '</text>';
      s += '<text x="' + (PL - 8) + '" y="' + (Y(t) + 4) + '" text-anchor="end">' + lab + '</text>';
    });
    var q10 = DATA.bandQ10, q90 = DATA.bandQ90;
    s += '<line class="band" x1="' + X(lo) + '" y1="' + Y(lo + q90) + '" x2="' + X(hi) + '" y2="' + Y(hi + q90) + '"/>';
    s += '<line class="band" x1="' + X(lo) + '" y1="' + Y(lo + q10) + '" x2="' + X(hi) + '" y2="' + Y(hi + q10) + '"/>';
    s += '<line class="ident" x1="' + X(lo) + '" y1="' + Y(lo) + '" x2="' + X(hi) + '" y2="' + Y(hi) + '"/>';
    pts.forEach(function (p) {
      var cx = X(Math.log(p.pred)), cy = Y(Math.log(p.act));
      s += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="3.4" fill="' + (p.holds ? '#0e7a3d' : '#b42318') + '" opacity="0.85"><title>' + esc(p.slug) + ' — actual ' + p.act.toFixed(2) + '×, predicted ' + p.pred.toFixed(2) + '×</title></circle>';
    });
    s += '<text x="' + (W / 2) + '" y="' + (H - 8) + '" text-anchor="middle">model prediction (×TVL, log scale)</text>';
    s += '<text x="14" y="' + (H / 2) + '" text-anchor="middle" transform="rotate(-90 14 ' + (H / 2) + ')">actual mcap/TVL (×TVL, log scale)</text>';
    s += '</svg>';
    var el = $('scatterWrap');
    if (el) el.innerHTML = s;
  }
  function renderErrTable() {
    var h = '';
    DATA.errors.forEach(function (e) {
      h += '<tr><td><b>' + esc(e.slug) + '</b></td><td>' + esc(e.category) + '</td><td class="r num">' + e.act.toFixed(4) + '×</td><td class="r num">' + e.pred.toFixed(4) + '×</td><td class="r num"><b>' + e.factor.toFixed(2) + '×</b></td><td>' + (ERR_NOTE[e.slug] || '') + '</td></tr>';
    });
    var tb = document.querySelector('#errTable tbody');
    if (tb) tb.innerHTML = h;
  }
  function renderT15() {
    var h = '';
    DATA.t15.experiments.forEach(function (e) {
      var ship = e.variant === 'V0-baseline-T1' ? ' ★ shipped' : '';
      h += '<tr><td><b>' + esc(e.variant) + '</b>' + ship + '</td><td class="r num">' + fmtX(e.loo_med) + '</td><td class="r num">' + fmtX(e.loo_geo) + '</td><td class="r num">' + fmtX(e.wf_med) + '</td><td class="r num">' + fmtX(e.wf_geo) + '</td><td class="r num">' + e.range_holds_pct.toFixed(1).replace('.', ',') + '%</td><td class="r num">' + e.top20_kept + '/20</td><td class="r num">' + fmtUSD(e.total_implied_v6_usd) + '</td></tr>';
    });
    var tb = document.querySelector('#t15Table tbody');
    if (tb) tb.innerHTML = h;
    var c = $('t15Conclusion');
    if (c) c.textContent = DATA.t15.conclusion;
  }

  // ---- Detail View: derivasi dua model; v6 range ($) HANYA di sini ----
  function findRow(slug) {
    for (var i = 0; i < rows.length; i++) if (rows[i].s === slug) return rows[i];
    return null;
  }
  function netGridHtml(r) {
    var h = '<table class="netgrid"><thead><tr><th>Deposit \\ Share</th>';
    SHARES.forEach(function (s) { h += '<th>' + (s * 100).toFixed(1).replace('.', ',') + '%</th>'; });
    h += '</tr></thead><tbody>';
    DEPS.forEach(function (dep) {
      h += '<tr><td><b>$' + dep.toLocaleString('en-US') + '</b></td>';
      SHARES.forEach(function (s) {
        var net = s * r.i5 * dep / r.tvl - r.fee;
        var be = Math.min(1, Math.max(0, r.fee / ((s * r.v5 * dep) / r.tvl)));
        var vd = net >= 5 && r.p5 >= 2 * be ? 'FARM' : net >= 0 && r.p5 >= be ? 'MARGINAL' : 'SKIP';
        var cls = 'num ' + (net >= 0 ? 'pos' : 'neg') + ((dep === D && s === S) ? ' active' : '');
        h += '<td class="' + cls + '">' + fmtUSD2(net) + ' · ' + vd + '</td>';
      });
      h += '</tr>';
    });
    return h + '</tbody></table><p class="small">Net grid v5 — the active cell is the current plan ($' + D.toLocaleString('en-US') + ' × ' + (S * 100).toFixed(1).replace('.', ',') + '%). net = s · implied5 · D / TVL − fees.</p>';
  }
  function openDetail(slug, scroll) {
    var r = findRow(slug);
    if (!r) return;
    selectedSlug = slug;
    var n5 = net5(r), b5 = be5(r), vd5 = verdict5(r);
    var n6 = net6(r), b6 = be6(r), vd6 = verdict6(r);
    var ph = usdPerHour(r, n5);
    var mins = rowMinutes(r);
    var comps = nearestTraded(r);
    var compRows = comps.map(function (l) {
      return '<tr><td><b>' + esc(l.n) + '</b><br><span class="small">' + esc(l.c || 'Other') + '</span></td><td class="r num">' + fmtUSD(l.tvl) + '</td><td class="r num">' + fmtUSD(l.mcap) + '</td><td class="r num">' + l.ratio.toFixed(2) + '×</td></tr>';
    }).join('') || '<tr><td colspan="4">No traded token in this category in the snapshot.</td></tr>';
    var tightHtml = isTight(r) ? '<span class="tight">Tight</span>' : '—';
    var derivRows = [
      ['Value if it launches <span class="prov v5">v5</span>', '<b>' + fmtUSD(r.v5) + '</b>', 'TVL × blended comp × growth × penalty'],
      ['P launch <span class="prov v5">v5</span>', fmtPct(r.p5), 'cohort (category, age) — see Evidence'],
      ['Implied = value × P <span class="prov v5">v5</span>', '<b>' + fmtUSD(r.i5) + '</b>', 'point estimate'],
      ['Implied P10 – P90 (v5 band) <span class="prov v5">v5</span>', fmtUSD(r.l5) + ' – ' + fmtUSD(r.h5), 'LOO residuals, q10/q90'],
      ['Net at active plan <span class="prov v5">v5</span>', '<span class="' + (n5 >= 0 ? 'pos' : 'neg') + '">' + fmtUSD2(n5) + '</span>', 'expected drop minus fees'],
      ['$/hour at active plan <span class="prov v5">v5</span>', ph == null ? '—' : '<b>' + fmtUSD2(ph) + '/h</b>', 'net ÷ ' + fmtTime(mins) + ' hands-on time'],
      ['Breakeven odds <span class="prov v5">v5</span>', fmtPct(b5), 'P(launch) at which the plan breaks even'],
      ['Verdict at active plan <span class="prov v5">v5</span>', '<span class="verdict ' + vd5 + '">' + vd5 + '</span>', 'FARM needs net ≥ $5 and odds ≥ 2× break-even'],
      ['V6 FDV est <span class="prov v6">v6</span>', '<b>' + fmtUSD(r.v6) + '</b>', 'Ridge log-linear ln(FDV/TVL), λ=' + DATA.meta.lambda],
      ['P launch <span class="prov v6">v6</span>', fmtPct(r.p6), 'Beta-Binomial (' + esc(r.pl) + ')'],
      ['Implied = V6 × P6 <span class="prov v6">v6</span>', '<b>' + fmtUSD(r.i6) + '</b>', 'point estimate'],
      ['Implied P10 – P90 (residual LOO) <span class="prov v6">v6</span>', fmtUSD(r.lo) + ' – ' + fmtUSD(r.hi), 'in dollars — no ratio shown'],
      ['Net P50 at active plan <span class="prov v6">v6</span>', '<span class="' + (n6 >= 0 ? 'pos' : 'neg') + '">' + fmtUSD2(n6) + '</span>', 'expected drop minus fees'],
      ['Net Range P10–P90 <span class="prov v6">v6</span>', fmtUSD2(net6Lo(r)) + ' – ' + fmtUSD2(net6Hi(r)), 'in dollars — no ratio shown'],
      ['Breakeven odds <span class="prov v6">v6</span>', fmtPct(b6), 'P(launch) at which the plan breaks even'],
      ['Verdict at active plan <span class="prov v6">v6</span>', '<span class="verdict ' + vd6 + '">' + vd6 + '</span>', 'same rule, v6 numbers'],
      ['Confidence <span class="prov v6">v6</span>', tightHtml, 'Tight = v6 interval ratio ≤ ×10. Wide ratios are never printed as a number — the $ ranges above are the honest figure.'],
    ].map(function (d) {
      return '<tr><td>' + d[0] + '</td><td><b>' + d[1] + '</b></td><td style="text-align:left;color:var(--muted)">' + d[2] + '</td></tr>';
    }).join('');
    var steps = r.fs.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var exitTvl = Math.round(r.tvl * 0.7);
    var reviewDate = addDays(DATA.meta.cutoff, 84);
    var h = '<div class="detail-head"><h3>' + esc(r.n) + '</h3>' +
      (r.wl ? '<span class="tag wl">★ watchlist</span>' : '') + '<span class="tag pre">pre-token</span>' +
      '<span class="small">' + esc(r.s) + ' · ' + esc(r.c || 'Other') + ' · ' + esc(r.ch.join(' / ')) + '</span></div>' +
      '<p>TVL <b class="num">' + fmtUSD(r.tvl) + '</b> · 7d <b class="num">' + fmtPct1(r.g7) + '</b> · no token recorded for <b>' + fmtAge(r.age) + '</b> · v5 rank <b>#' + r.r + '</b> of 198 · fees <b class="num">' + fmtUSD2(r.fee) + '</b></p>' +
      '<p><span class="verdict ' + vd5 + '">' + vd5 + '</span> <b>' + fmtUSD2(n5) + ' net over 12 weeks</b> at $' + D.toLocaleString('en-US') + ' deposit / ' + (S * 100).toFixed(1).replace('.', ',') + '% drop share' + (ph == null ? '' : ' · <b>' + fmtUSD2(ph) + '/h</b>') + '</p>' +
      '<div class="detail-grid"><div><h4>Derivation — two models, each labelled</h4>' +
      '<table class="deriv"><tbody>' + derivRows + '</tbody></table>' +
      '<p class="small">Model v5: category_comp ' + r.m5[0].toFixed(4) + ' · powerlaw ' + r.m5[1].toFixed(4) + ' · blended ' + r.m5[2].toFixed(4) + ' · growth ×' + r.m5[3].toFixed(4) + ' · drawdown ×' + r.m5[4].toFixed(4) + '. Model v6: Ridge log-linear ln(FDV/TVL), λ=' + DATA.meta.lambda + '.</p></div>' +
      '<div><h4>Nearest traded comparables — anchors from the peers’ record</h4>' +
      '<table class="mini"><thead><tr><th>Protocol</th><th class="r">TVL</th><th class="r">Market cap</th><th class="r">mcap/TVL</th></tr></thead><tbody>' + compRows + '</tbody></table>' +
      '<p class="small">These are traded tokens in the same category, closest by TVL. They are the anchors the category comp is built from.</p>' +
      '<h4>Net grid — all plans (v5)</h4>' + netGridHtml(r) + '</div></div>' +
      '<h4>Farm plan — ' + r.fs.length + ' steps (costed + timed)</h4><ol class="farm">' + steps + '</ol>' +
      '<p class="small">Hands-on time for this plan: <b>' + fmtTime(mins) + '</b> (parsed from the steps’ own “Time:” lines; weekly steps × 12 weeks). At the active plan this is <b>' + (ph == null ? '—' : fmtUSD2(ph) + '/h') + '</b>. Fees total ' + fmtUSD2(r.fee) + ' over 12 weeks (setup + weekly check-ins + exit).</p>' +
      '<h4>Exit rule &amp; review</h4><p><b>Exit:</b> withdraw if TVL falls below 70% of the snapshot week — below <b>' + fmtUSD(exitTvl) + '</b> — or if a token launches and the drop is claimed; never pay a third-party claim fee.</p>' +
      '<p><b>Review date:</b> ' + reviewDate + ' (snapshot ' + esc(DATA.meta.cutoff) + ' + 12 weeks). Re-check TVL, odds and verdict then; the cohort moves as protocols launch.</p>' +
      '<p class="small">Implied value is a model, not a promise. This protocol records no token on DefiLlama — that is not proof it has none.</p>' +
      '<p><button class="linklike" id="detailClose">← Close detail &amp; back to the table</button></p>';
    $('detailBody').innerHTML = h;
    $('detailTitle').textContent = 'Detail View — ' + r.n + ' (#' + r.r + ' v5)';
    $('detailClose').addEventListener('click', function () { closeDetail(); });
    try { history.replaceState(null, '', '#/protocol/' + slug); } catch (e) { /* ignore */ }
    renderTable();
    if (scroll !== false) $('detail').scrollIntoView({ behavior: 'auto', block: 'start' });
  }
  function closeDetail() {
    selectedSlug = null;
    $('detailBody').innerHTML = '<p class="small">No protocol selected. Click any board row for its derivation, traded anchors, net grid, and full farm plan.</p>';
    $('detailTitle').textContent = 'Detail View — click a row above';
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    renderTable();
  }

  // ---- wiring & init ----
  function refresh() {
    renderKPIs();
    renderFilters();
    renderTable();
    if (selectedSlug) openDetail(selectedSlug, false);
  }
  function renderFoot() {
    $('foot').innerHTML = 'Token Radar v6.2 (hybrid) · ranking + verdict point-estimate v5, intervals P10–P90 model v6 Ridge log-linear ln(FDV/TVL), λ=' + DATA.meta.lambda + ', cutoff ' + DATA.meta.cutoff + ' · ' +
      'Sources: board-198 (sha256 ' + DATA.meta.boardSha.slice(0, 12) + '…) + model_v6 (sha256 ' + DATA.meta.modelSha.slice(0, 12) + '…) · ' +
      'Intervals P10–P90 from LOO residual quantiles per category · v5 validation frozen from the v5 entry’s own data.js · ' +
      'Static app — data loaded from data.json at the output root, no external assets · ' +
      'Built deterministically by main.ts (token-radar-v6.2).';
  }
  function init(data) {
    DATA = data; rows = data.rows; VAL = data.val;
    COMP = data.composition; LIVE = data.live || []; COHORT = data.cohort; V5VAL = data.v5val;
    $('loading').hidden = true;
    $('app').hidden = false;
    renderKPIs();
    renderCoverage();
    renderFilters();
    renderTable();
    renderEvidence();
    renderFoot();
    document.querySelector('#mainTable tbody').addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-slug]');
      if (tr) openDetail(tr.getAttribute('data-slug'));
    });
    document.querySelectorAll('#mainTable th[data-k]').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-k');
        if (sortKey === k) sortDir = -sortDir;
        else { sortKey = k; sortDir = (k === 'name') ? 1 : -1; }
        renderTable();
      });
    });
    // Deep links: applied at load and on every hash change (so a shared
    // #/protocol/<slug> or #/verdict/FARM link works without a reload).
    function applyHash() {
      var m = location.hash.match(/^#\/protocol\/([A-Za-z0-9._-]+)$/);
      if (m) { openDetail(m[1], false); return; }
      var v = location.hash.match(/^#\/verdict\/(FARM|MARGINAL|SKIP)$/i);
      if (v) { state.verdict = v[1].toUpperCase(); refresh(); }
      else if (location.hash === '#/watchlist') { state.scope = 'watchlist'; refresh(); }
    }
    window.addEventListener('hashchange', applyHash);
    applyHash();
  }

  fetch('../data.json')
    .then(function (res) {
      if (!res.ok) throw new Error('data.json HTTP ' + res.status);
      return res.json();
    })
    .then(init)
    .catch(function (err) {
      $('loading').hidden = true;
      var el = $('loadError');
      el.hidden = false;
      el.textContent = 'Failed to load data.json: ' + err.message + ' — open the dashboard through a local server (not as a bare file) so the relative fetch works.';
    });
})();
