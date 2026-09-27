// Same-realm round-trip: ExcelJS loaded INSIDE the vm sandbox
var fs = require('fs'), vm = require('vm');
var sb = { console: console, require: require, module: { exports: {} }, globalThis: null };
sb.globalThis = sb;
vm.runInNewContext('var ExcelJS = require("C:/Users/krypt/Documents/dev/node_modules/exceljs");', sb);

var mb = { exports: {} }; sb.module = mb; sb.exports = mb.exports;
vm.runInNewContext(fs.readFileSync('./js/schedule.js', 'utf8'), sb);
var SL = mb.exports;

// schedule-excel: browser branch (no module in scope) so it uses root.ScheduleLogic
var sb2 = { console: console, ExcelJS: sb.ExcelJS, ScheduleLogic: SL, globalThis: null };
sb2.globalThis = sb2;
vm.runInNewContext(fs.readFileSync('./js/schedule-excel.js', 'utf8'), sb2);
var SX = sb2.ScheduleExcel;

var s = {
  projectName: 'P', methodology: 'Waterfall', plannedStart: '2026-09-27', plannedEnd: '2026-12-05',
  planScheduleManagement: { policy: 'p', tools: ['Jira'], roles: 'r' },
  activities: [{ id: 'A1', wbsId: '1', name: 'n', description: 'd', isMilestone: false, optimistic: 1, mostLikely: 2, pessimistic: 3, expectedDuration: 2, durationDays: 2, resources: [], constraint: '' }],
  dependencies: [], resourcePlan: { levelingNotes: 'a', smoothingNotes: 'b' },
  compression: { crashOptions: [], fastTrackOptions: [] },
  controlPlan: { baselineDate: '2026-09-27', varianceThreshold: 'x', velocityTarget: '', retrospectiveCadence: 'y', changeControlProcess: 'z' }
};

SX.buildScheduleWorkbook(s).xlsx.writeBuffer().then(function (buf) {
  var w2 = new sb.ExcelJS.Workbook();
  return w2.xlsx.load(buf).then(function () {
    var ws = w2.getWorksheet('1-Plan & Control');
    // rows: 1 title, 2 subtitle, 3 meta, 4 blank/header-start... find label rows
    var found = [];
    for (var r = 1; r <= 22; r++) {
      var a = ws.getCell('A' + r).value;
      var b = ws.getCell('B' + r).value;
      if (a) found.push(r + ': ' + a + ' => ' + (b && b.constructor && b.constructor.name) + ' ' + JSON.stringify(b));
    }
    console.log(found.join('\n'));
    var startRow = found.filter(function (f) { return f.indexOf('Planned Start') !== -1; })[0];
    var v = ws.getCell('B' + startRow.split(':')[0]).value;
    console.log('\nPlanned Start is Date?', v instanceof Date, '| iso:', v instanceof Date ? v.toISOString() : v);
    var fails = 0;
    if (!(v instanceof Date)) { fails++; console.log('FAIL: date not a Date object'); }
    else if (v.toISOString().slice(0, 10) !== '2026-09-27') { fails++; console.log('FAIL: wrong date'); }
    console.log(fails ? fails + ' FAILURES' : 'SAME-REALM ROUND-TRIP OK (dates are real Dates in-browser)');
    process.exit(fails ? 1 : 0);
  });
}).catch(function (e) { console.error('ERROR', e); process.exit(1); });
