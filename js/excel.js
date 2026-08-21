/* =====================================================================
   Charter Forge · Excel workbook builder
   Reproduces the classic blue "Project Charter" sheet layout:
   dark-blue label rail, light-blue content blocks, milestone/deadline
   and stakeholder name/role sub-tables, bordered approval box.
   UMD: works in the browser (global ExcelJS) and in Node (npm exceljs).
   ===================================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('exceljs'));
  } else {
    root.ExcelBuilder = factory(root.ExcelJS);
  }
})(typeof self !== 'undefined' ? self : this, function (ExcelJS) {
  'use strict';

  var COLORS = {
    dark: 'FF2F5597',
    lightBlue: 'FFBDD7EE',
    paleBlue: 'FFEEF3FB',
    white: 'FFFFFFFF',
    ink: 'FF1A1A1A',
    approvalBorder: 'FF262626'
  };

  var COL = { A: 1, B: 2, C: 3, D: 4 };
  var WIDTH = { A: 30, B: 56, C: 36, D: 22 };
  var CHARS_FULL = 104;  // usable chars across merged B:D
  var CHARS_B = 50;      // usable chars in column B alone
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ---------- small utilities ---------- */

  function parseRef(ref) {
    var m = /^([A-Z])(\d+):([A-Z])(\d+)$/.exec(ref);
    if (!m) throw new Error('Bad range: ' + ref);
    return { c1: COL[m[1]], r1: +m[2], c2: COL[m[3]], r2: +m[4] };
  }

  function eachCell(ws, ref, fn) {
    var p = parseRef(ref);
    for (var r = p.r1; r <= p.r2; r++) {
      for (var c = p.c1; c <= p.c2; c++) {
        fn(ws.getRow(r).getCell(c), r, c);
      }
    }
  }

  function estHeight(text, charsPerLine, min) {
    var s = String(text === null || text === undefined ? '' : text);
    if (!s) return min || 22;
    var segs = s.split('\n');
    var lines = 0;
    for (var i = 0; i < segs.length; i++) {
      lines += Math.max(1, Math.ceil(segs[i].length / Math.max(10, charsPerLine)));
    }
    return Math.max(min || 22, lines * 15.2 + 9);
  }

  function toDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return null;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  function fmtDate(iso) {
    var d = toDate(iso);
    if (!d) return String(iso || '');
    var dd = ('0' + d.getUTCDate()).slice(-2);
    return dd + '-' + MONTHS[d.getUTCMonth()] + '-' + d.getUTCFullYear();
  }

  function numbered(i, text) {
    return i + '. ' + text;
  }

  /* ---------- workbook ---------- */

  function buildWorkbook(charter) {
    var wb = new ExcelJS.Workbook();
    wb.creator = 'Charter Forge';
    wb.lastModifiedBy = 'Charter Forge';
    wb.created = new Date();
    wb.modified = new Date();

    var ws = wb.addWorksheet('Project Charter', {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      properties: { tabColor: { argb: COLORS.dark } }
    });

    ws.getColumn(1).width = WIDTH.A;
    ws.getColumn(2).width = WIDTH.B;
    ws.getColumn(3).width = WIDTH.C;
    ws.getColumn(4).width = WIDTH.D;

    var WHITE_B = { style: 'thin', color: { argb: COLORS.white } };
    var DARK_B = { style: 'thin', color: { argb: COLORS.approvalBorder } };

    function style(ref, o) {
      o = o || {};
      eachCell(ws, ref, function (cell) {
        if (o.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } };
        cell.font = {
          name: 'Calibri',
          size: o.size || 11,
          bold: !!o.bold,
          italic: false,
          color: { argb: o.color || COLORS.ink }
        };
        cell.alignment = {
          vertical: o.valign || 'middle',
          horizontal: o.halign || 'left',
          wrapText: true
        };
        cell.border = { top: WHITE_B, bottom: WHITE_B, left: WHITE_B, right: WHITE_B };
        if (o.numFmt) cell.numFmt = o.numFmt;
      });
    }

    function setValue(ref, value) {
      ws.getCell(ref).value = value;
    }

    function mergeAndStyle(ref, value, o) {
      var p = parseRef(ref);
      if (p.c2 > p.c1 || p.r2 > p.r1) ws.mergeCells(ref);
      style(ref, o);
      if (value !== undefined && value !== null) {
        ws.getCell(ref.split(':')[0]).value = value;
      }
    }

    function outlineDark(ref) {
      var p = parseRef(ref);
      eachCell(ws, ref, function (cell, r, c) {
        cell.border = {
          top: r === p.r1 ? DARK_B : WHITE_B,
          bottom: r === p.r2 ? DARK_B : WHITE_B,
          left: c === p.c1 ? DARK_B : WHITE_B,
          right: c === p.c2 ? DARK_B : WHITE_B
        };
      });
    }

    var heights = {};
    function setH(r, h) {
      heights[r] = Math.max(heights[r] || 0, h);
    }

    function label(fromRow, toRow, text) {
      var ref = 'A' + fromRow + ':A' + toRow;
      if (toRow > fromRow) ws.mergeCells(ref);
      style(ref, { fill: COLORS.dark, color: COLORS.white, bold: true, size: 12, halign: 'center' });
      setValue('A' + fromRow, text);
    }

    function contentRow(r, text, fill, o) {
      o = o || {};
      mergeAndStyle('B' + r + ':D' + r, text, {
        fill: fill,
        size: o.size || 11,
        bold: !!o.bold,
        valign: o.valign || 'middle',
        halign: o.halign || 'left'
      });
      setH(r, estHeight(text, CHARS_FULL, o.minH || 22));
    }

    /* ----- title ----- */
    mergeAndStyle('B1:D1', 'Project Charter', {
      fill: COLORS.dark, color: COLORS.white, bold: true, size: 18, halign: 'center'
    });
    style('A1:A1', { fill: COLORS.dark });
    setH(1, 34);

    var r = 2;
    var start;

    /* ----- project name ----- */
    label(r, r, 'Project Name');
    contentRow(r, charter.projectName || '', COLORS.lightBlue, { bold: true, size: 12 });
    r++;

    /* ----- objective ----- */
    label(r, r, 'Objective');
    contentRow(r, charter.objective || '', COLORS.lightBlue, { valign: 'top' });
    r++;

    /* ----- success criteria ----- */
    label(r, r, 'Success Criteria');
    var critText = (charter.successCriteria || []).map(function (s, i) { return numbered(i + 1, s); }).join('\n');
    contentRow(r, critText, COLORS.lightBlue, { valign: 'top', minH: 40 });
    r++;

    /* ----- key deliverables ----- */
    label(r, r, 'Key Deliverables');
    var delivText = (charter.keyDeliverables || []).map(function (s, i) { return numbered(i + 1, s); }).join('\n');
    contentRow(r, delivText, COLORS.lightBlue, { valign: 'top', minH: 40 });
    r++;

    /* ----- milestones ----- */
    start = r;
    mergeAndStyle('B' + r + ':B' + r, 'Milestones', { fill: COLORS.dark, color: COLORS.white, bold: true, halign: 'center' });
    mergeAndStyle('C' + r + ':D' + r, 'Deadlines', { fill: COLORS.dark, color: COLORS.white, bold: true, halign: 'center' });
    setH(r, 20);
    r++;
    var ms = (charter.milestones && charter.milestones.length) ? charter.milestones : [{ name: '', deadline: '' }];
    ms.forEach(function (m, i) {
      mergeAndStyle('B' + r + ':B' + r, m.name ? numbered(i + 1, m.name) : '', { fill: COLORS.lightBlue });
      var p = parseRef('C' + r + ':D' + r);
      if (p.c2 > p.c1) ws.mergeCells('C' + r + ':D' + r);
      style('C' + r + ':D' + r, { fill: COLORS.lightBlue, halign: 'right' });
      var d = toDate(m.deadline);
      var cell = ws.getCell('C' + r);
      if (d) {
        cell.value = d;
        cell.numFmt = 'dd-mmm-yyyy';
      } else {
        cell.value = m.deadline || '';
      }
      setH(r, estHeight(m.name, CHARS_B, 22));
      r++;
    });
    label(start, r - 1, 'Milestones');

    /* ----- high level requirements ----- */
    start = r;
    var reqs = (charter.highLevelRequirements && charter.highLevelRequirements.length)
      ? charter.highLevelRequirements : [''];
    reqs.forEach(function (q, i) {
      contentRow(r, q ? numbered(i + 1, q) : '', COLORS.paleBlue, { valign: 'top' });
      r++;
    });
    label(start, r - 1, 'High Level Requirements:');

    /* ----- resource: budget + team members ----- */
    start = r;
    contentRow(r, 'Budget : ' + (charter.budget || ''), COLORS.paleBlue);
    r++;
    contentRow(r, 'Team members :', COLORS.paleBlue);
    r++;
    var members = (charter.teamMembers && charter.teamMembers.length) ? charter.teamMembers : [''];
    members.forEach(function (m, i) {
      contentRow(r, m ? numbered(i + 1, m) : '', COLORS.paleBlue);
      r++;
    });
    label(start, r - 1, 'Resource');

    /* ----- risks ----- */
    start = r;
    var risks = (charter.risks && charter.risks.length) ? charter.risks : [{ risk: '', mitigation: '' }];
    risks.forEach(function (rk, i) {
      var line = rk.risk ? numbered(i + 1, rk.risk) : '';
      if (rk.risk && rk.mitigation) line += ' (Mitigation: ' + rk.mitigation.replace(/\.?\s*$/, '') + ').';
      contentRow(r, line, COLORS.paleBlue, { valign: 'top' });
      r++;
    });
    label(start, r - 1, 'Risks');

    /* ----- stakeholders ----- */
    start = r;
    mergeAndStyle('B' + r + ':B' + r, 'Name', { fill: COLORS.dark, color: COLORS.white, bold: true, halign: 'center' });
    mergeAndStyle('C' + r + ':D' + r, 'Role', { fill: COLORS.dark, color: COLORS.white, bold: true, halign: 'center' });
    setH(r, 20);
    r++;
    var stk = (charter.stakeholders && charter.stakeholders.length) ? charter.stakeholders : [{ name: '', role: '' }];
    stk.forEach(function (s, i) {
      mergeAndStyle('B' + r + ':B' + r, s.name ? numbered(i + 1, s.name) : '', { fill: COLORS.paleBlue });
      mergeAndStyle('C' + r + ':D' + r, s.role ? numbered(i + 1, s.role) : '', { fill: COLORS.paleBlue });
      setH(r, Math.max(estHeight(s.name, CHARS_B, 22), estHeight(s.role, 52, 22)));
      r++;
    });
    label(start, r - 1, 'Stakeholders');

    /* ----- project manager ----- */
    start = r;
    var pms = (charter.projectManagers && charter.projectManagers.length) ? charter.projectManagers : [''];
    pms.forEach(function (pm, i) {
      contentRow(r, pm ? numbered(i + 1, pm) : '', COLORS.paleBlue);
      r++;
    });
    label(start, r - 1, 'Project Manager');

    /* ----- approval ----- */
    start = r;
    var ap = charter.approval || {};
    var apName = 'Name: ' + (ap.name || '');
    var apTitle = 'Title: ' + (ap.title || '');
    var apSig = 'Signature : ' + (ap.signature || '');
    var apDate = 'Date: ' + fmtDate(ap.date);

    ws.mergeCells('B' + r + ':C' + r);
    style('B' + r + ':D' + r, { fill: COLORS.paleBlue });
    setValue('B' + r, apName);
    setValue('D' + r, apTitle);
    setH(r, 24);
    r++;
    ws.mergeCells('B' + r + ':C' + r);
    style('B' + r + ':D' + r, { fill: COLORS.paleBlue });
    setValue('B' + r, apSig);
    setValue('D' + r, apDate);
    setH(r, 24);
    label(start, r, 'Approval');
    outlineDark('B' + start + ':D' + r);

    /* ----- apply row heights ----- */
    Object.keys(heights).forEach(function (rowNum) {
      ws.getRow(+rowNum).height = heights[rowNum];
    });

    return wb;
  }

  return {
    buildWorkbook: buildWorkbook,
    fmtDate: fmtDate
  };
});
