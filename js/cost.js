/* =====================================================================
   Charter Forge · Cost Management (EVM)
   Implements every assignment from the course PDF:
     1. EVM Variance Calculation (All)      CV = EV-AC, SV = EV-PV
     2. Performance Index Analysis (All)    CPI = EV/AC, SPI = EV/PV
     3. Forecasting with EVM (All)          EAC / ETC / VAC / TCPI
     4. AI-enhanced Forecasting (Odd ID)    regression on CPI/SPI history
     5. Anomaly Detection (Even ID)         isolation-style scoring
   Vanilla JS + canvas charts. No backend, no build step.
   ===================================================================== */

(function () {
  'use strict';

  var LS_KEY = 'cf_cost_state_v1';

  var EXAMPLE = [
    { name: 'Sprint 1', pv: 100, ev: 80, ac: 90 },
    { name: 'Sprint 2', pv: 180, ev: 150, ac: 170 },
    { name: 'Sprint 3', pv: 260, ev: 230, ac: 240 },
    { name: 'Sprint 4', pv: 340, ev: 300, ac: 330 },
    { name: 'Sprint 5', pv: 420, ev: 360, ac: 410 },
    { name: 'Sprint 6', pv: 500, ev: 430, ac: 480 }
  ];

  function num(v, fb) {
    var n = parseFloat(v);
    return isFinite(n) ? n : (fb !== undefined ? fb : 0);
  }
  function safeDiv(a, b) {
    a = num(a); b = num(b);
    if (!isFinite(a) || !isFinite(b) || b === 0) return null;
    return a / b;
  }
  function r2(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return (Math.round(v * 100) / 100).toLocaleString('en-US');
  }
  function r3(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return String(Math.round(v * 1000) / 1000);
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---------------- pure EVM math (also unit-testable) ---------------- */

  function variances(pv, ev, ac) {
    pv = num(pv); ev = num(ev); ac = num(ac);
    var cv = ev - ac, sv = ev - pv;
    var cpi = safeDiv(ev, ac), spi = safeDiv(ev, pv);
    return {
      cv: cv, sv: sv, cpi: cpi, spi: spi,
      budgetLabel: cv > 0 ? 'Under budget' : (cv < 0 ? 'Over budget' : 'On budget'),
      schedLabel: sv > 0 ? 'Ahead' : (sv < 0 ? 'Behind' : 'On schedule')
    };
  }

  function eacVariants(bac, ev, ac, cpi, spi) {
    bac = num(bac); ev = num(ev); ac = num(ac);
    var typical = (cpi && cpi !== 0) ? bac / cpi : null;
    var atypical = ac + (bac - ev);
    var composite = (cpi && spi) ? ac + (bac - ev) / (cpi * spi) : null;
    return { typical: typical, atypical: atypical, composite: composite };
  }

  function linreg(ys) {
    var n = ys.length;
    if (n < 2) return { slope: 0, intercept: ys[0] || 0, pred: ys[0] || 0 };
    var sx = 0, sy = 0, sxx = 0, sxy = 0, cnt = 0;
    ys.forEach(function (y, i) {
      if (y === null || !isFinite(y)) return;
      var x = i + 1;
      sx += x; sy += y; sxx += x * x; sxy += x * y; cnt++;
    });
    if (cnt < 2) return { slope: 0, intercept: sy / Math.max(1, cnt), pred: sy / Math.max(1, cnt) };
    var denom = cnt * sxx - sx * sx;
    var slope = denom === 0 ? 0 : (cnt * sxy - sx * sy) / denom;
    var intercept = (sy - slope * sx) / cnt;
    return { slope: slope, intercept: intercept, pred: slope * (n + 1) + intercept };
  }

  function median(a) {
    var s = a.filter(isFinite).slice().sort(function (x, y) { return x - y; });
    if (!s.length) return 0;
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function stdev(a, mean) {
    var f = a.filter(isFinite);
    if (f.length < 2) return 1;
    var v = f.reduce(function (t, x) { return t + (x - mean) * (x - mean); }, 0) / f.length;
    return Math.sqrt(v) || 1;
  }

  /* Isolation-style anomaly scoring: z-scores over CV%, SV%, CPI, SPI.
     Browser-friendly stand-in for Isolation Forest — same idea:
     points far from the crowd in several dimensions isolate fast. */
  function anomalyScores(rows) {
    var cvs = rows.map(function (r) { return r.ev ? (r.cv / r.ev) * 100 : 0; });
    var svs = rows.map(function (r) { return r.pv ? (r.sv / r.pv) * 100 : 0; });
    var cpis = rows.map(function (r) { return r.cpi === null ? 1 : r.cpi; });
    var spis = rows.map(function (r) { return r.spi === null ? 1 : r.spi; });
    var stats = [
      { m: median(cvs), s: stdev(cvs, median(cvs)) },
      { m: median(svs), s: stdev(svs, median(svs)) },
      { m: median(cpis), s: stdev(cpis, median(cpis)) },
      { m: median(spis), s: stdev(spis, median(spis)) }
    ];
    return rows.map(function (r, i) {
      var feats = [cvs[i], svs[i], cpis[i], spis[i]];
      var z = feats.map(function (f, k) { return Math.abs((f - stats[k].m) / (stats[k].s || 1)); });
      var score = (z[0] + z[1] + z[2] + z[3]) / 4;
      // Extra penalty for jointly bad cost+schedule (classic risk signature)
      if (r.cpi !== null && r.spi !== null && r.cpi < 0.95 && r.spi < 0.95) score += 0.35;
      var level = score >= 1.6 ? 'HIGH RISK' : (score >= 1.0 ? 'WATCH' : 'Normal');
      var detail = 'CV%=' + r2(cvs[i]) + '%, SV%=' + r2(svs[i]) + '%, CPI=' + r3(r.cpi) + ', SPI=' + r3(r.spi) +
        (level === 'Normal' ? ' — within normal band.' :
          ' — deviates from sprint norm' + (r.cpi !== null && r.cpi < 1 ? '; burning budget faster than earned' : '') +
          (r.spi !== null && r.spi < 1 ? '; earning slower than planned' : '') + '. Review scope, staffing and blockers.');
      return { name: r.name, score: score, level: level, flagged: score >= 1.0, detail: detail };
    });
  }

  /* ---------------- state ---------------- */

  function defaultState() {
    return {
      projectName: 'Sample Software Project',
      bac: 600, currency: '$', unit: 'k',
      eacMethod: 'typical',
      studentDigit: '',
      sprints: EXAMPLE.map(function (s) { return { name: s.name, pv: s.pv, ev: s.ev, ac: s.ac }; })
    };
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return defaultState();
      var s = JSON.parse(raw);
      if (!Array.isArray(s.sprints) || !s.sprints.length) return defaultState();
      s.sprints = s.sprints.slice(0, 24).map(function (r, i) {
        return { name: String(r.name || ('Sprint ' + (i + 1))), pv: num(r.pv), ev: num(r.ev), ac: num(r.ac) };
      });
      s.bac = num(s.bac, 600);
      return Object.assign(defaultState(), s);
    } catch (e) { return defaultState(); }
  }

  var state = loadState();
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {} }

  /* ---------------- compute ---------------- */

  function compute() {
    var bac = num(state.bac);
    var rows = state.sprints.map(function (s) {
      var v = variances(s.pv, s.ev, s.ac);
      var evs = eacVariants(bac, num(s.ev), num(s.ac), v.cpi, v.spi);
      var eac = state.eacMethod === 'atypical' ? evs.atypical
        : state.eacMethod === 'composite' ? (evs.composite === null ? evs.typical : evs.composite)
        : evs.typical;
      var etc = eac === null ? null : eac - num(s.ac);
      var vac = eac === null ? null : bac - eac;
      return Object.assign({ name: s.name, pv: num(s.pv), ev: num(s.ev), ac: num(s.ac) }, v,
        { eac: eac, etc: etc, vac: vac, variants: evs });
    });

    var tpv = 0, tev = 0, tac = 0;
    rows.forEach(function (r) { tpv += r.pv; tev += r.ev; tac += r.ac; });
    // Note: sprint inputs are cumulative-to-date snapshots (standard EVM),
    // so the summary uses the LATEST sprint, not the sum.
    var last = rows[rows.length - 1] || { pv: 0, ev: 0, ac: 0, cv: 0, sv: 0, cpi: null, spi: null };
    var summary = { pv: last.pv, ev: last.ev, ac: last.ac, cv: last.cv, sv: last.sv, cpi: last.cpi, spi: last.spi,
      totals: { pv: tpv, ev: tev, ac: tac } };

    var fin = eacVariants(bac, last.ev, last.ac, last.cpi, last.spi);
    var eac = state.eacMethod === 'atypical' ? fin.atypical
      : state.eacMethod === 'composite' ? (fin.composite === null ? fin.typical : fin.composite)
      : fin.typical;
    var methodLabel = state.eacMethod === 'atypical' ? 'atypical AC+(BAC−EV)'
      : state.eacMethod === 'composite' ? 'composite AC+(BAC−EV)/(CPI·SPI)' : 'typical BAC/CPI';
    var forecast = {
      eac: eac, etc: eac === null ? null : eac - last.ac, vac: eac === null ? null : bac - eac,
      tcpiBac: (bac - last.ev) !== 0 && (bac - last.ac) !== 0 ? (bac - last.ev) / (bac - last.ac) : null,
      tcpiEac: (eac !== null && (eac - last.ac) !== 0) ? (bac - last.ev) / (eac - last.ac) : null,
      methodLabel: methodLabel
    };

    var cpiHist = rows.map(function (r) { return r.cpi; }).filter(function (v) { return v !== null && isFinite(v); });
    var spiHist = rows.map(function (r) { return r.spi; }).filter(function (v) { return v !== null && isFinite(v); });
    var rc = linreg(cpiHist), rs = linreg(spiHist);
    var ai = {
      nextCpi: cpiHist.length ? rc.slope * (cpiHist.length + 1) + rc.intercept : null,
      nextSpi: spiHist.length ? rs.slope * (spiHist.length + 1) + rs.intercept : null,
      slopeCpi: rc.slope, slopeSpi: rs.slope,
      aiEac: null, preds: []
    };
    for (var k = 1; k <= 3; k++) {
      ai.preds.push({
        sprint: 'Sprint ' + (rows.length + k) + ' (AI)',
        cpi: cpiHist.length ? rc.slope * (cpiHist.length + k) + rc.intercept : null,
        spi: spiHist.length ? rs.slope * (spiHist.length + k) + rs.intercept : null
      });
    }
    ai.aiEac = (ai.nextCpi && ai.nextCpi > 0) ? bac / ai.nextCpi : null;

    var anomalies = anomalyScores(rows);
    return { rows: rows, summary: summary, eacVariants: fin, forecast: forecast, ai: ai, anomalies: anomalies };
  }

  /* ---------------- rendering ---------------- */

  var $ = function (sel) { return document.querySelector(sel); };

  function money(v) { return r2(v); }

  function toast(msg, kind) {
    var box = $('#toasts');
    if (!box) { alert(msg); return; }
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(function () { el.classList.add('leaving'); setTimeout(function () { el.remove(); }, 300); }, 4200);
  }

  function pillFor(v, goodWhen) {
    if (v === null || v === undefined || !isFinite(v)) return '<span class="pill neutral">—</span>';
    if (goodWhen === 'pos') return v > 0 ? '<span class="pill good">● favourable</span>' : (v < 0 ? '<span class="pill bad">● adverse</span>' : '<span class="pill neutral">● on plan</span>');
    if (goodWhen === 'one') return v > 1 ? '<span class="pill good">● good</span>' : (v < 1 ? '<span class="pill bad">● poor</span>' : '<span class="pill neutral">● on plan</span>');
    return '<span class="pill neutral">—</span>';
  }

  function renderAll() {
    var c = compute();
    renderAssignCards();
    renderTable(c);
    renderKpis(c);
    renderForecast(c);
    renderAI(c);
    renderAnomalies(c);
    drawCharts(c);
    save();
    return c;
  }

  function renderAssignCards() {
    var d = parseInt(state.studentDigit, 10);
    var cards = document.querySelectorAll('.assign-card[data-track]');
    cards.forEach(function (el) {
      var t = el.getAttribute('data-track');
      el.classList.remove('dim');
      if (isNaN(d)) return;
      var isOdd = d % 2 === 1;
      if (t === 'odd' && !isOdd) el.classList.add('dim');
      if (t === 'even' && isOdd) el.classList.add('dim');
    });
    var note = $('#track-note');
    if (note) {
      if (isNaN(d)) note.textContent = 'Enter the last digit of your Student ID to highlight your AI track — all three core modules always apply.';
      else if (d % 2 === 1) note.textContent = 'Last digit ' + d + ' is odd → your AI track is AI-enhanced Forecasting (§4). Anomaly Detection (§5) is shown for reference.';
      else note.textContent = 'Last digit ' + d + ' is even → your AI track is Anomaly Detection (§5). AI Forecasting (§4) is shown for reference.';
    }
  }

  function renderTable(c) {
    var tb = $('#evm-tbody');
    if (!tb) return;
    var html = '';
    c.rows.forEach(function (r, i) {
      var flagged = c.anomalies[i] && c.anomalies[i].flagged;
      html += '<tr' + (flagged ? ' class="flagged"' : '') + '>' +
        '<td class="l"><input class="sprint-name" data-r="' + i + '" data-f="name" value="' + esc(r.name) + '" /></td>' +
        '<td><input type="number" data-r="' + i + '" data-f="pv" value="' + esc(r.pv) + '" /></td>' +
        '<td><input type="number" data-r="' + i + '" data-f="ev" value="' + esc(r.ev) + '" /></td>' +
        '<td><input type="number" data-r="' + i + '" data-f="ac" value="' + esc(r.ac) + '" /></td>' +
        '<td>' + money(r.cv) + '</td><td>' + money(r.sv) + '</td>' +
        '<td>' + r3(r.cpi) + '</td><td>' + r3(r.spi) + '</td>' +
        '<td>' + pillFor(r.cv, 'pos') + '</td><td>' + pillFor(r.sv, 'pos') + '</td>' +
        '<td>' + money(r.eac) + '</td><td>' + money(r.etc) + '</td>' +
        '<td>' + (flagged ? '⚠ ' + esc(c.anomalies[i].level) : '<span class="pill good">✓ ok</span>') + '</td>' +
        '<td><button class="row-remove-btn" data-del="' + i + '" title="Remove sprint">×</button></td>' +
        '</tr>';
    });
    tb.innerHTML = html;
    var s = c.summary;
    $('#evm-tfoot').innerHTML = '<tr><td class="l">Latest (cumulative position)</td><td>' + money(s.pv) +
      '</td><td>' + money(s.ev) + '</td><td>' + money(s.ac) + '</td><td>' + money(s.cv) +
      '</td><td>' + money(s.sv) + '</td><td>' + r3(s.cpi) + '</td><td>' + r3(s.spi) +
      '</td><td>' + pillFor(s.cv, 'pos') + '</td><td>' + pillFor(s.sv, 'pos') +
      '</td><td>' + money(c.forecast.eac) + '</td><td>' + money(c.forecast.etc) +
      '</td><td colspan="2">BAC ' + money(state.bac) + '</td></tr>';
  }

  function renderKpis(c) {
    var s = c.summary, f = c.forecast;
    var over = s.cv < 0, behind = s.sv < 0;
    var banner = $('#health-banner');
    if (banner) {
      var cls = (!over && !behind) ? 'good' : (s.cpi !== null && s.cpi < 0.9) || (s.spi !== null && s.spi < 0.9) ? 'bad' : 'warn';
      banner.className = 'health-banner ' + cls;
      banner.innerHTML = '<strong>Project health:</strong> ' +
        (over ? 'OVER budget by ' + money(-s.cv) + ' (CV negative).' : 'UNDER budget by ' + money(s.cv) + ' (CV positive).') + ' ' +
        (behind ? 'BEHIND schedule by ' + money(-s.sv) + ' (SV negative).' : 'AHEAD of schedule by ' + money(s.sv) + ' (SV positive).') +
        ' CPI ' + r3(s.cpi) + ' · SPI ' + r3(s.spi) + '.';
    }
    function set(id, val, sub, tone) {
      var el = document.getElementById(id);
      if (!el) return;
      el.querySelector('.k-val').textContent = val;
      el.querySelector('.k-sub').textContent = sub;
      el.className = 'kpi ' + (tone || '');
    }
    set('kpi-cv', (s.cv >= 0 ? '+' : '') + money(s.cv), s.cv >= 0 ? 'Under budget — EV exceeds AC' : 'Over budget — AC exceeds EV', s.cv >= 0 ? 'good' : 'bad');
    set('kpi-sv', (s.sv >= 0 ? '+' : '') + money(s.sv), s.sv >= 0 ? 'Ahead — EV exceeds PV' : 'Behind — PV exceeds EV', s.sv >= 0 ? 'good' : 'bad');
    set('kpi-cpi', r3(s.cpi), s.cpi === null ? 'No actual cost yet' : (s.cpi >= 1 ? 'Efficient — every $1 earns ≥$1' : 'Inefficient — overrun per $1 spent'), s.cpi === null ? '' : (s.cpi >= 1 ? 'good' : 'bad'));
    set('kpi-spi', r3(s.spi), s.spi === null ? 'No planned value yet' : (s.spi >= 1 ? 'On/ahead of schedule' : 'Delayed — earning slower than planned'), s.spi === null ? '' : (s.spi >= 1 ? 'good' : 'bad'));
    set('kpi-eac', money(f.eac), 'Forecast final cost (' + f.methodLabel + ')', f.eac !== null && f.eac > num(state.bac) ? 'bad' : 'good');
    set('kpi-etc', money(f.etc), 'Still to spend (EAC − AC)', '');
    set('kpi-vac', ((f.vac !== null && f.vac >= 0) ? '+' : '') + money(f.vac), f.vac === null ? '' : (f.vac >= 0 ? 'Expected underrun vs BAC' : 'Expected overrun vs BAC'), f.vac === null ? '' : (f.vac >= 0 ? 'good' : 'bad'));
    set('kpi-tcpi', r3(f.tcpiBac), 'Efficiency needed from now to hit BAC', f.tcpiBac === null ? '' : (f.tcpiBac > 1 ? 'warn' : 'good'));
  }

  function renderForecast(c) {
    var f = c.forecast, v = c.eacVariants;
    var el = $('#forecast-body');
    if (!el) return;
    el.innerHTML =
      '<p><strong>Selected method:</strong> ' + esc(f.methodLabel) + ' → <strong>EAC ' + money(f.eac) +
      '</strong> · ETC ' + money(f.etc) + ' · VAC ' + money(f.vac) + ' · TCPI(BAC) ' + r3(f.tcpiBac) + '</p>' +
      '<table class="formula-table"><tr><th>Method</th><th>EAC</th><th>When to use</th></tr>' +
      '<tr><td><code>BAC / CPI</code> (typical)</td><td>' + money(v.typical) + '</td><td>Current cost efficiency continues.</td></tr>' +
      '<tr><td><code>AC + (BAC − EV)</code> (atypical)</td><td>' + money(v.atypical) + '</td><td>Variance was one-off; future as planned.</td></tr>' +
      '<tr><td><code>AC + (BAC − EV)/(CPI·SPI)</code> (composite)</td><td>' + money(v.composite) + '</td><td>Both cost and schedule pressure continue.</td></tr></table>' +
      '<div class="note-box">Reading the forecast: EAC above BAC means an expected overrun of ' +
      money((f.eac !== null ? f.eac : 0) - num(state.bac)) + '. TCPI above 1.0 means the team must become more efficient than it has been to still hit BAC — harder the higher it climbs.</div>';
  }

  function renderAI(c) {
    var ai = c.ai, f = c.forecast;
    var el = $('#ai-body');
    if (!el) return;
    var rowsHtml = ai.preds.map(function (p) {
      return '<tr><td>' + esc(p.sprint) + '</td><td>' + r3(p.cpi) + '</td><td>' + r3(p.spi) + '</td><td>' +
        ((p.cpi && p.cpi >= 1) ? 'Efficient' : 'Overrunning') + ' / ' + ((p.spi && p.spi >= 1) ? 'On schedule' : 'Delayed') + '</td></tr>';
    }).join('');
    var cmp = (ai.aiEac !== null && f.eac !== null) ? (ai.aiEac - f.eac) : null;
    el.innerHTML =
      '<div class="compare-grid"><div><h3 style="font-size:14px;margin:0 0 8px">Regression projection (next 3 sprints)</h3>' +
      '<table class="formula-table"><tr><th>Sprint</th><th>CPÎ</th><th>SPÎ</th><th>Reading</th></tr>' + rowsHtml + '</table></div>' +
      '<div><h3 style="font-size:14px;margin:0 0 8px">AI vs traditional</h3>' +
      '<table class="formula-table"><tr><th>Estimator</th><th>EAC</th></tr>' +
      '<tr><td>Traditional (' + esc(f.methodLabel) + ')</td><td>' + money(f.eac) + '</td></tr>' +
      '<tr><td>AI (BAC / predicted CPI)</td><td>' + money(ai.aiEac) + '</td></tr>' +
      '<tr><td>Difference (AI − traditional)</td><td>' + (cmp === null ? '—' : (cmp >= 0 ? '+' : '') + money(cmp)) + '</td></tr></table>' +
      '<div class="note-box">Method: ordinary least-squares regression over the recorded CPI/SPI series ' +
      '(CPI trend ' + (ai.slopeCpi >= 0 ? 'improving ▲' : 'deteriorating ▼') + ', SPI trend ' + (ai.slopeSpi >= 0 ? 'improving ▲' : 'deteriorating ▼') + '). ' +
      'In a production setup this is where a Random Forest or LSTM would sit — same inputs (PV/EV/AC history), same outputs (future CPI/SPI), but able to learn non-linear and seasonal patterns. ' +
      'With 6+ sprints the regression already shows whether AI expects recovery or continued drift.</div></div></div>';
  }

  function renderAnomalies(c) {
    var el = $('#anomaly-body');
    if (!el) return;
    var flagged = c.anomalies.filter(function (a) { return a.flagged; });
    el.innerHTML =
      '<p><strong>' + flagged.length + ' of ' + c.anomalies.length + ' sprints flagged.</strong> ' +
      'Isolation-style score blends CV%, SV%, CPI drift and SPI drift vs the sprint norm; jointly bad cost+schedule adds a risk premium.</p>' +
      '<table class="formula-table"><tr><th>Sprint</th><th>Score</th><th>Verdict</th><th>What it means</th></tr>' +
      c.anomalies.map(function (a) {
        var cls = a.level === 'HIGH RISK' ? 'flag-high' : (a.level === 'WATCH' ? 'flag-med' : 'flag-ok');
        return '<tr><td>' + esc(a.name) + '</td><td>' + (Math.round(a.score * 100) / 100) + '</td><td class="' + cls + '">' + esc(a.level) + '</td><td>' + esc(a.detail) + '</td></tr>';
      }).join('') + '</table>' +
      '<div class="note-box">Production equivalent: Isolation Forest on the same four features isolates rare sprints in few splits — high anomaly score ≈ isolated in few splits ≈ this table\u2019s HIGH RISK. Act on flagged sprints first: re-estimate, de-scope, or add capacity before the variance compounds.</div>';
  }

  /* ---------------- canvas charts (dependency-free) ---------------- */

  function setupCanvas(id) {
    var cv = document.getElementById(id);
    if (!cv) return null;
    var dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth || 480, h = 230;
    cv.width = w * dpr; cv.height = h * dpr;
    var ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }
  function axes(g, pad) {
    g.ctx.strokeStyle = 'rgba(28,36,64,0.25)';
    g.ctx.lineWidth = 1;
    g.ctx.beginPath();
    g.ctx.moveTo(pad.l, pad.t);
    g.ctx.lineTo(pad.l, g.h - pad.b);
    g.ctx.lineTo(g.w - pad.r, g.h - pad.b);
    g.ctx.stroke();
  }
  function line(g, pts, color, dashed) {
    g.ctx.strokeStyle = color; g.ctx.lineWidth = 2;
    g.ctx.setLineDash(dashed ? [5, 4] : []);
    g.ctx.beginPath();
    pts.forEach(function (p, i) { if (i === 0) g.ctx.moveTo(p[0], p[1]); else g.ctx.lineTo(p[0], p[1]); });
    g.ctx.stroke();
    g.ctx.setLineDash([]);
    g.ctx.fillStyle = color;
    pts.forEach(function (p) { g.ctx.beginPath(); g.ctx.arc(p[0], p[1], 3, 0, 7); g.ctx.fill(); });
  }

  function drawCharts(c) {
    var pad = { l: 38, r: 12, t: 12, b: 26 };
    // 1) CPI / SPI trend
    var g1 = setupCanvas('chart-trend');
    if (g1) {
      axes(g1, pad);
      var vals = [];
      c.rows.forEach(function (r) { if (r.cpi !== null) vals.push(r.cpi); if (r.spi !== null) vals.push(r.spi); });
      c.ai.preds.forEach(function (p) { if (p.cpi) vals.push(p.cpi); if (p.spi) vals.push(p.spi); });
      vals.push(1);
      var lo = Math.min.apply(null, vals.concat([0.7])), hi = Math.max.apply(null, vals.concat([1.2]));
      var X = function (i, n) { return pad.l + (i * (g1.w - pad.l - pad.r)) / Math.max(1, n - 1); };
      var Y = function (v) { return (g1.h - pad.b) - ((v - lo) / Math.max(0.001, hi - lo)) * (g1.h - pad.t - pad.b); };
      var n = c.rows.length + c.ai.preds.length;
      line(g1, [[pad.l, Y(1)], [g1.w - pad.r, Y(1)]], 'rgba(28,36,64,0.4)', true);
      line(g1, c.rows.map(function (r, i) { return [X(i, n), Y(r.cpi === null ? 1 : r.cpi)]; }), '#2e6b4f');
      line(g1, c.rows.map(function (r, i) { return [X(i, n), Y(r.spi === null ? 1 : r.spi)]; }), '#2f5597');
      line(g1, c.ai.preds.map(function (p, k) { return [X(c.rows.length + k, n), Y(p.cpi === null ? 1 : p.cpi)]; }), '#2e6b4f', true);
      line(g1, c.ai.preds.map(function (p, k) { return [X(c.rows.length + k, n), Y(p.spi === null ? 1 : p.spi)]; }), '#2f5597', true);
      g1.ctx.fillStyle = '#46506e'; g1.ctx.font = '10px IBM Plex Mono, monospace';
      g1.ctx.fillText('1.0 baseline', pad.l + 4, Y(1) - 5);
      g1.ctx.fillText('CPI solid · SPI solid · AI dashed', pad.l, g1.h - 8);
    }
    // 2) PV / EV / AC bars
    var g2 = setupCanvas('chart-bars');
    if (g2) {
      axes(g2, pad);
      var max = 1;
      c.rows.forEach(function (r) { max = Math.max(max, r.pv, r.ev, r.ac); });
      var gw = (g2.w - pad.l - pad.r) / Math.max(1, c.rows.length);
      var colors = ['#7c85a0', '#2f5597', '#b3402e'];
      c.rows.forEach(function (r, i) {
        [r.pv, r.ev, r.ac].forEach(function (v, k) {
          var bw = gw / 4, x = pad.l + i * gw + k * bw + gw * 0.12;
          var h = ((v || 0) / max) * (g2.h - pad.t - pad.b);
          g2.ctx.fillStyle = colors[k];
          g2.ctx.fillRect(x, g2.h - pad.b - h, bw, h);
        });
        g2.ctx.fillStyle = '#46506e'; g2.ctx.font = '9px IBM Plex Mono, monospace';
        g2.ctx.fillText('S' + (i + 1), pad.l + i * gw + gw * 0.12, g2.h - 8);
      });
    }
    // 3) CV / SV diverging
    var g3 = setupCanvas('chart-var');
    if (g3) {
      axes(g3, pad);
      var m = 1;
      c.rows.forEach(function (r) { m = Math.max(m, Math.abs(r.cv), Math.abs(r.sv)); });
      var mid = pad.t + (g3.h - pad.t - pad.b) / 2;
      g3.ctx.strokeStyle = 'rgba(28,36,64,0.4)';
      g3.ctx.beginPath(); g3.ctx.moveTo(pad.l, mid); g3.ctx.lineTo(g3.w - pad.r, mid); g3.ctx.stroke();
      var gw3 = (g3.w - pad.l - pad.r) / Math.max(1, c.rows.length);
      c.rows.forEach(function (r, i) {
        [[r.cv, '#2e6b4f'], [r.sv, '#2f5597']].forEach(function (pair, k) {
          var v = pair[0] || 0;
          var bw = gw3 / 3, x = pad.l + i * gw3 + k * bw + gw3 * 0.16;
          var h = (Math.abs(v) / m) * ((g3.h - pad.t - pad.b) / 2);
          g3.ctx.fillStyle = v < 0 ? '#b3402e' : pair[1];
          if (v >= 0) g3.ctx.fillRect(x, mid - h, bw, h);
          else g3.ctx.fillRect(x, mid, bw, h);
        });
        g3.ctx.fillStyle = '#46506e'; g3.ctx.font = '9px IBM Plex Mono, monospace';
        g3.ctx.fillText('S' + (i + 1), pad.l + i * gw3 + gw3 * 0.16, g3.h - 8);
      });
    }
    // 4) EAC forecast gauge-ish bars
    var g4 = setupCanvas('chart-eac');
    if (g4) {
      axes(g4, pad);
      var f = c.forecast, v = c.eacVariants, bac = num(state.bac);
      var items = [
        ['BAC', bac, '#1c2440'],
        ['Typ', v.typical === null ? 0 : v.typical, '#7c85a0'],
        ['Atyp', v.atypical === null ? 0 : v.atypical, '#2f5597'],
        ['Comp', v.composite === null ? 0 : v.composite, '#b98a1d'],
        ['AI', c.ai.aiEac === null ? 0 : c.ai.aiEac, '#2e6b4f']
      ];
      var mx = 1;
      items.forEach(function (it) { mx = Math.max(mx, it[1] || 0); });
      var bw = (g4.w - pad.l - pad.r) / items.length;
      items.forEach(function (it, i) {
        var h = ((it[1] || 0) / mx) * (g4.h - pad.t - pad.b - 18);
        g4.ctx.fillStyle = it[2];
        g4.ctx.fillRect(pad.l + i * bw + bw * 0.2, g4.h - pad.b - h, bw * 0.6, h);
        g4.ctx.fillStyle = '#1c2440'; g4.ctx.font = '9px IBM Plex Mono, monospace';
        g4.ctx.fillText(it[0], pad.l + i * bw + bw * 0.2, g4.h - 8);
        g4.ctx.fillText(r2(it[1]), pad.l + i * bw + bw * 0.1, g4.h - pad.b - h - 4);
      });
      void f;
    }
  }

  /* ---------------- events ---------------- */

  function syncControls() {
    $('#f-project').value = state.projectName;
    $('#f-bac').value = state.bac;
    $('#f-method').value = state.eacMethod;
    $('#f-digit').value = state.studentDigit;
    var gb = $('#g-bac');
    if (gb && !gb.value) gb.value = state.bac;
  }

  function setSprints(sprints, bac, projectName) {
    if (Array.isArray(sprints) && sprints.length) {
      state.sprints = sprints.slice(0, 24).map(function (r, i) {
        return { name: String(r.name || ('Sprint ' + (i + 1))), pv: num(r.pv), ev: num(r.ev), ac: num(r.ac) };
      });
    }
    if (bac !== undefined && isFinite(num(bac)) && num(bac) > 0) state.bac = num(bac);
    if (projectName) state.projectName = String(projectName);
    syncControls();
    renderAll();
  }

  function bindControls() {
    syncControls();
    $('#f-project').addEventListener('input', function (e) { state.projectName = e.target.value; renderAll(); });
    $('#f-bac').addEventListener('input', function (e) { state.bac = num(e.target.value, 0); renderAll(); });
    $('#f-method').addEventListener('change', function (e) { state.eacMethod = e.target.value; renderAll(); });
    $('#f-digit').addEventListener('input', function (e) {
      state.studentDigit = e.target.value.replace(/\D/g, '').slice(-1);
      e.target.value = state.studentDigit;
      renderAll();
    });
    $('#btn-add').addEventListener('click', function () {
      if (state.sprints.length >= 24) { toast('Maximum 24 sprints.', 'error'); return; }
      var last = state.sprints[state.sprints.length - 1] || { pv: 0, ev: 0, ac: 0 };
      state.sprints.push({ name: 'Sprint ' + (state.sprints.length + 1), pv: num(last.pv) + 80, ev: num(last.ev) + 70, ac: num(last.ac) + 75 });
      renderAll();
    });
    $('#btn-example').addEventListener('click', function () {
      state = defaultState();
      syncControls();
      renderAll();
      toast('Example dataset loaded (Sprint 1 = PDF worked example).', 'success');
    });
    $('#btn-del-last').addEventListener('click', function () {
      if (state.sprints.length <= 1) { toast('Keep at least one sprint — clear its values instead.', 'error'); return; }
      var dropped = state.sprints.pop();
      renderAll();
      toast('Removed ' + (dropped.name || 'last sprint') + '.', 'success');
    });
    $('#btn-reset').addEventListener('click', function () {
      state.sprints = [{ name: 'Sprint 1', pv: 100, ev: 80, ac: 90 }];
      renderAll();
    });
    $('#btn-print').addEventListener('click', function () { window.print(); });
    $('#btn-excel').addEventListener('click', function () {
      if (typeof window.ExcelJS === 'undefined' || !window.CostExcel) { toast('Excel engine not loaded — check connection.', 'error'); return; }
      var c = compute();
      var wb = window.CostExcel.buildWorkbook(
        { projectName: state.projectName || 'Project', bac: num(state.bac) }, c);
      wb.xlsx.writeBuffer().then(function (buf) {
        var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = String(state.projectName || 'project').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 50) + '-evm-report.xlsx';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
        toast('EVM workbook downloaded (5 sheets).', 'success');
      }).catch(function (err) { toast('Export failed: ' + (err && err.message || 'unknown'), 'error'); });
    });

    var tb = $('#evm-tbody');
    tb.addEventListener('input', function (e) {
      var t = e.target;
      var r = parseInt(t.getAttribute('data-r'), 10);
      var f = t.getAttribute('data-f');
      if (!state.sprints[r]) return;
      if (f === 'name') state.sprints[r].name = t.value;
      else state.sprints[r][f] = num(t.value, 0);
      // live recompute without rebuilding inputs (keeps focus)
      var c = compute();
      renderKpis(c); renderForecast(c); renderAI(c); renderAnomalies(c); drawCharts(c); renderAssignCards();
      updateFoot(c);
      save();
    });
    tb.addEventListener('click', function (e) {
      var b = e.target.closest('[data-del]');
      if (!b) return;
      var i = parseInt(b.getAttribute('data-del'), 10);
      if (state.sprints.length <= 1) { toast('Keep at least one sprint.', 'error'); return; }
      state.sprints.splice(i, 1);
      renderAll();
    });
  }

  function updateFoot(c) {
    var s = c.summary;
    var tf = $('#evm-tfoot');
    if (tf) tf.innerHTML = '<tr><td class="l">Latest (cumulative position)</td><td>' + money(s.pv) +
      '</td><td>' + money(s.ev) + '</td><td>' + money(s.ac) + '</td><td>' + money(s.cv) +
      '</td><td>' + money(s.sv) + '</td><td>' + r3(s.cpi) + '</td><td>' + r3(s.spi) +
      '</td><td>' + pillFor(s.cv, 'pos') + '</td><td>' + pillFor(s.sv, 'pos') +
      '</td><td>' + money(c.forecast.eac) + '</td><td>' + money(c.forecast.etc) +
      '</td><td colspan="2">BAC ' + money(state.bac) + '</td></tr>';
  }

  function prefillFromCharter() {
    try {
      var bac = null, name = null;
      // charter budget may look like "$12,000 (breakdown)" — grab the number
      var candidates = [localStorage.getItem('cf_last_budget'), localStorage.getItem('cf_last_project')];
      if (candidates[0]) { var m = String(candidates[0]).replace(/,/g, '').match(/(\d+(\.\d+)?)/); if (m) bac = parseFloat(m[1]); }
      if (candidates[1]) name = candidates[1];
      if (name && !state.projectName) state.projectName = name;
      void bac;
    } catch (e) {}
  }

  function init() {
    prefillFromCharter();
    bindControls();
    renderAll();
    window.addEventListener('resize', function () { drawCharts(compute()); });
  }

  // expose pure math for Node tests
  if (typeof window !== 'undefined') {
    window.CostEVM = { variances: variances, eacVariants: eacVariants, linreg: linreg, anomalyScores: anomalyScores, computeFor: function (sprints, bac, method) {
      var keep = { sprints: state.sprints, bac: state.bac, eacMethod: state.eacMethod };
      state.sprints = sprints; state.bac = bac; state.eacMethod = method || 'typical';
      var c = compute();
      state.sprints = keep.sprints; state.bac = keep.bac; state.eacMethod = keep.eacMethod;
      return c;
    },
    getSnapshot: function () {
      return {
        projectName: state.projectName, bac: num(state.bac), eacMethod: state.eacMethod,
        sprints: state.sprints.map(function (s) { return { name: s.name, pv: num(s.pv), ev: num(s.ev), ac: num(s.ac) }; }),
        computed: compute()
      };
    },
    setSprints: setSprints };
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = { variances: variances, eacVariants: eacVariants, linreg: linreg, anomalyScores: anomalyScores };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
