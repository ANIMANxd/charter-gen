// Same-realm (browser reality): build + verify in ONE realm using runInThisContext
var fs = require('fs');
var ExcelJS = require('C:/Users/krypt/Documents/dev/node_modules/exceljs');

// schedule.js exports via module branch
var mb = { exports: {} };
new Function('module', 'exports', fs.readFileSync('./js/schedule.js', 'utf8'))(mb, mb.exports);
var SL = mb.exports;

// schedule-excel: browser branch, ExcelJS + ScheduleLogic as globals in THIS realm
var root = globalThis;
root.ExcelJS = ExcelJS;
root.ScheduleLogic = SL;
new Function(fs.readFileSync('./js/schedule-excel.js', 'utf8'))();
var SX = root.ScheduleExcel;

var schedule = {
  projectName: 'OmniBrain On-Device Intelligence Engine (OBOD)',
  methodology: 'Hybrid',
  plannedStart: '2026-09-27',
  plannedEnd: '2026-12-05',
  planScheduleManagement: { policy: 'Manage schedule baseline using hybrid agile sprints.', tools: ['Jira', 'Confluence'], roles: 'PM monitors timeline' },
  activities: [
    { id: 'A101', wbsId: '1.1', name: 'Architecture Design', description: 'd', isMilestone: false, estimationMethod: 'PERT', optimistic: 6.8, mostLikely: 9, pessimistic: 11.3, expectedDuration: 9, durationDays: 9, resources: ['Architect'], constraint: '' },
    { id: 'A109', wbsId: '4.2', name: 'Completion', description: 'd', isMilestone: true, durationDays: 0, resources: [], constraint: '' }
  ],
  dependencies: [{ from: 'A101', to: 'A109', type: 'FS', lagDays: 0, leadDays: 0 }],
  resourcePlan: { levelingNotes: 'lvl', smoothingNotes: 'smo' },
  compression: { crashOptions: ['crash'], fastTrackOptions: ['fast'] },
  controlPlan: { baselineDate: '2026-09-27', varianceThreshold: '±3d', velocityTarget: '13 pts', retrospectiveCadence: 'Bi-weekly', changeControlProcess: 'CCB review' },
  planCheck: { ok: true, targetDays: 50, actualDays: 50, gates: ['Local Vector Database Specialist → day 15'], adjustments: [] }
};

SX.buildScheduleWorkbook(schedule).xlsx.writeBuffer().then(function (buf) {
  var wb2 = new ExcelJS.Workbook();
  return wb2.xlsx.load(buf).then(function () {
    var ws = wb2.getWorksheet('1-Plan & Control');
    var fails = 0;
    function eq(ref, want) {
      var v = ws.getCell(ref).value;
      var got = v instanceof Date ? v.toISOString().slice(0, 10) : (v && v.result !== undefined ? String(v.result) : String(v));
      if (got !== want) { fails++; console.log('FAIL  ' + ref + ' want ' + JSON.stringify(want) + ' got ' + JSON.stringify(got)); }
      else console.log('PASS  ' + ref + ' = ' + got);
    }
    // Find rows dynamically by label
    function rowOf(label) {
      for (var r = 1; r <= 30; r++) if (ws.getCell('A' + r).value === label) return r;
      return -1;
    }
    var labels = ['Plan Check', 'Project', 'Methodology', 'Planned Start', 'Planned End', 'Duration (CPM)', 'Policy', 'Tools', 'Roles', 'Baseline Date', 'Variance Threshold', 'Change Control'];
    labels.forEach(function (l) { if (rowOf(l) === -1) { fails++; console.log('FAIL  missing label row: ' + l); } });
    eq('B' + rowOf('Plan Check'), 'Target 50 working days → actual 50 (exact match)  ·  Gates: Local Vector Database Specialist → day 15');
    eq('B' + rowOf('Project'), 'OmniBrain On-Device Intelligence Engine (OBOD)');
    eq('B' + rowOf('Planned Start'), '2026-09-27');
    eq('B' + rowOf('Planned End'), '2026-12-05');
    eq('B' + rowOf('Policy'), 'Manage schedule baseline using hybrid agile sprints.');
    eq('B' + rowOf('Tools'), 'Jira  ·  Confluence');
    eq('B' + rowOf('Variance Threshold'), '±3d');
    // date cell must be a real Excel date
    var sv = ws.getCell('B' + rowOf('Planned Start')).value;
    if (!(sv instanceof Date)) { fails++; console.log('FAIL  Planned Start is not a Date: ' + typeof sv); }
    else console.log('PASS  Planned Start is a real Excel date, numFmt=' + ws.getCell('B' + rowOf('Planned Start')).numFmt);
    // no empty content cells in label/value pairs
    for (var r = 5; r <= rowOf('Backlog Reprioritization'); r++) {
      var a = ws.getCell('A' + r).value, b = ws.getCell('B' + r).value;
      if (a && (b === null || b === undefined || b === '')) { fails++; console.log('FAIL  empty value next to label ' + a + ' (row ' + r + ')'); }
    }
    console.log(fails ? '\n' + fails + ' FAILURES' : '\nSHEET-1 FULLY VERIFIED (no blank cells, dates are real)');
    process.exit(fails ? 1 : 0);
  });
}).catch(function (e) { console.error('ERROR', e); process.exit(1); });
