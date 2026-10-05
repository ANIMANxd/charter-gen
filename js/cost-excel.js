/* =====================================================================
   Charter Forge · Cost Management Excel export
   Builds a formatted EVM workbook (Report, EVM Table, Forecast,
   Anomalies, About). UMD: browser global CostExcel, Node module.
   ===================================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('exceljs'));
  else root.CostExcel = factory(root.ExcelJS);
})(typeof self !== 'undefined' ? self : this, function (ExcelJS) {
  'use strict';

  var DARK = 'FF2F5597', LIGHT = 'FFBDD7EE', PALE = 'FFEEF3FB',
      WHITE = 'FFFFFFFF', INK = 'FF1A1A1A', RED = 'FFFFE9E9',
      GREEN = 'FFE4F2E8';

  function styleRow(ws, r, ncols, fill, bold, color) {
    for (var c = 1; c <= ncols; c++) {
      var cell = ws.getRow(r).getCell(c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      cell.font = { name: 'Calibri', size: 11, bold: !!bold, color: { argb: color || INK } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: WHITE } },
        bottom: { style: 'thin', color: { argb: WHITE } },
        left: { style: 'thin', color: { argb: WHITE } },
        right: { style: 'thin', color: { argb: WHITE } }
      };
    }
  }

  function header(ws, titles, widths) {
    widths.forEach(function (w, i) { ws.getColumn(i + 1).width = w; });
    titles.forEach(function (t, i) { ws.getRow(1).getCell(i + 1).value = t; });
    styleRow(ws, 1, titles.length, DARK, true, 'FFFFFFFF');
    ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    ws.getRow(1).height = 30;
  }

  function money(v) { return (v === null || v === undefined || !isFinite(v)) ? '—' : Math.round(v * 100) / 100; }
  function idx(v) { return (v === null || v === undefined || !isFinite(v)) ? '—' : Math.round(v * 1000) / 1000; }

  function buildWorkbook(state, computed) {
    var wb = new ExcelJS.Workbook();
    wb.creator = 'Charter Forge · Cost Management';
    wb.created = new Date();
    var s = state, rows = computed.rows, sum = computed.summary,
        fc = computed.forecast, ai = computed.ai, an = computed.anomalies;

    /* ---- Sheet 1: Report ---- */
    var ws = wb.addWorksheet('Report', { properties: { tabColor: { argb: DARK } } });
    ws.getColumn(1).width = 26; ws.getColumn(2).width = 60;
    var rep = [
      ['Project', s.projectName],
      ['Budget at Completion (BAC)', s.bac],
      ['Sprints recorded', rows.length],
      ['Overall CV (EV-AC)', money(sum.cv) + (sum.cv >= 0 ? ' — UNDER budget' : ' — OVER budget')],
      ['Overall SV (EV-PV)', money(sum.sv) + (sum.sv >= 0 ? ' — AHEAD of schedule' : ' — BEHIND schedule')],
      ['Cumulative CPI', idx(sum.cpi)],
      ['Cumulative SPI', idx(sum.spi)],
      ['EAC (' + fc.methodLabel + ')', money(fc.eac)],
      ['ETC (EAC-AC)', money(fc.etc)],
      ['VAC (BAC-EAC)', money(fc.vac)],
      ['TCPI to BAC', idx(fc.tcpiBac)],
      ['AI next CPI (regression)', idx(ai.nextCpi)],
      ['AI next SPI (regression)', idx(ai.nextSpi)],
      ['Anomalies flagged', an.filter(function (a) { return a.flagged; }).length + ' of ' + an.length]
    ];
    ws.getRow(1).getCell(1).value = 'EVM Cost Management Report';
    ws.mergeCells('A1:B1');
    styleRow(ws, 1, 2, DARK, true, 'FFFFFFFF');
    ws.getRow(1).height = 28;
    rep.forEach(function (r, i) {
      ws.getRow(i + 2).getCell(1).value = r[0];
      ws.getRow(i + 2).getCell(2).value = r[1];
      styleRow(ws, i + 2, 2, i % 2 ? PALE : LIGHT, i % 2 === 0);
    });

    /* ---- Sheet 2: EVM table ---- */
    var w2 = wb.addWorksheet('EVM Table', { properties: { tabColor: { argb: DARK } } });
    var T = ['Sprint', 'PV', 'EV', 'AC', 'CV=EV-AC', 'SV=EV-PV', 'CPI=EV/AC', 'SPI=EV/PV', 'Budget?', 'Schedule?', 'EAC', 'ETC', 'VAC'];
    header(w2, T, [14, 12, 12, 12, 13, 13, 12, 12, 14, 14, 13, 13, 13]);
    rows.forEach(function (r, i) {
      var vals = [r.name, money(r.pv), money(r.ev), money(r.ac), money(r.cv), money(r.sv),
        idx(r.cpi), idx(r.spi), r.budgetLabel, r.schedLabel, money(r.eac), money(r.etc), money(r.vac)];
      vals.forEach(function (v, j) { w2.getRow(i + 2).getCell(j + 1).value = v; });
      var flagged = an[i] && an[i].flagged;
      styleRow(w2, i + 2, T.length, flagged ? RED : (i % 2 ? PALE : LIGHT), false);
      w2.getRow(i + 2).height = 20;
    });
    var fr = rows.length + 2;
    ['TOTAL', money(sum.pv), money(sum.ev), money(sum.ac), money(sum.cv), money(sum.sv),
      idx(sum.cpi), idx(sum.spi), '', '', money(fc.eac), money(fc.etc), money(fc.vac)
    ].forEach(function (v, j) { w2.getRow(fr).getCell(j + 1).value = v; });
    styleRow(w2, fr, T.length, LIGHT, true);

    /* ---- Sheet 3: Forecast ---- */
    var w3 = wb.addWorksheet('Forecast', { properties: { tabColor: { argb: DARK } } });
    header(w3, ['Item', 'Value', 'Method / note'], [34, 20, 60]);
    var fl = [
      ['EAC — typical (BAC/CPI)', money(computed.eacVariants.typical), 'Assumes CPI stays as observed'],
      ['EAC — atypical AC+(BAC-EV)', money(computed.eacVariants.atypical), 'One-off variance, future as planned'],
      ['EAC — composite AC+(BAC-EV)/(CPI*SPI)', money(computed.eacVariants.composite), 'Both cost & schedule pressures continue'],
      ['Selected EAC (' + fc.methodLabel + ')', money(fc.eac), 'Chosen in app controls'],
      ['ETC (EAC-AC)', money(fc.etc), 'Remaining spend'],
      ['VAC (BAC-EAC)', money(fc.vac), 'Negative = expected overrun'],
      ['TCPI to BAC', idx(fc.tcpiBac), 'Efficiency needed to hit BAC'],
      ['AI predicted next CPI', idx(ai.nextCpi), 'Least-squares regression on CPI history'],
      ['AI predicted next SPI', idx(ai.nextSpi), 'Least-squares regression on SPI history'],
      ['AI-implied EAC (BAC/predicted CPI)', money(ai.aiEac), 'Compare with traditional EAC above']
    ];
    fl.forEach(function (r, i) {
      w3.getRow(i + 2).getCell(1).value = r[0];
      w3.getRow(i + 2).getCell(2).value = r[1];
      w3.getRow(i + 2).getCell(3).value = r[2];
      styleRow(w3, i + 2, 3, i % 2 ? PALE : LIGHT, false);
    });

    /* ---- Sheet 4: Anomalies ---- */
    var w4 = wb.addWorksheet('Anomalies', { properties: { tabColor: { argb: DARK } } });
    header(w4, ['Sprint', 'Score', 'Verdict', 'Detail'], [14, 12, 16, 70]);
    an.forEach(function (a, i) {
      w4.getRow(i + 2).getCell(1).value = a.name;
      w4.getRow(i + 2).getCell(2).value = Math.round(a.score * 100) / 100;
      w4.getRow(i + 2).getCell(3).value = a.level;
      w4.getRow(i + 2).getCell(4).value = a.detail;
      styleRow(w4, i + 2, 4, a.flagged ? RED : GREEN, a.flagged);
    });

    /* ---- Sheet 5: About ---- */
    var w5 = wb.addWorksheet('About', { properties: { tabColor: { argb: DARK } } });
    w5.getColumn(1).width = 26; w5.getColumn(2).width = 80;
    var about = [
      ['CV', 'EV − AC. Positive = under budget, negative = over budget.'],
      ['SV', 'EV − PV. Positive = ahead of schedule, negative = behind.'],
      ['CPI', 'EV / AC. >1 efficient, <1 overrunning.'],
      ['SPI', 'EV / PV. >1 ahead, <1 delayed.'],
      ['EAC', 'Typical BAC/CPI · Atypical AC+(BAC−EV) · Composite AC+(BAC−EV)/(CPI·SPI).'],
      ['ETC', 'EAC − AC (cost to finish).  VAC = BAC − EAC.'],
      ['AI forecasting', 'In-browser least-squares regression on CPI/SPI history stands in for Random Forest/LSTM: it learns the trend and projects the next sprints, compared against classical EAC.'],
      ['Anomaly detection', 'In-browser isolation-style scoring (z-scores of CV%, SV%, CPI/SPI drift) stands in for Isolation Forest: high-isolation (rare, far-from-median) sprints are flagged as risks.'],
      ['Example', 'PV=100, EV=80, AC=90 → CV=−10 (over), SV=−20 (behind), CPI=0.89, SPI=0.8.']
    ];
    w5.getRow(1).getCell(1).value = 'Formula';
    w5.getRow(1).getCell(2).value = 'Meaning';
    styleRow(w5, 1, 2, DARK, true, 'FFFFFFFF');
    about.forEach(function (r, i) {
      w5.getRow(i + 2).getCell(1).value = r[0];
      w5.getRow(i + 2).getCell(2).value = r[1];
      styleRow(w5, i + 2, 2, i % 2 ? PALE : LIGHT, false);
    });

    return wb;
  }

  return { buildWorkbook: buildWorkbook };
});
