// Recompute the user's OBOD schedule numbers independently to verify accuracy
var fs = require('fs');
var mb = { exports: {} };
new Function('module', 'exports', fs.readFileSync('./js/schedule.js', 'utf8'))(mb, mb.exports);
var SL = mb.exports;

var schedule = {
  projectName: 'OBOD', methodology: 'Hybrid',
  plannedStart: '2026-09-27', plannedEnd: '2026-12-05',
  workingDaysPerWeek: 5,
  activities: [
    { id: 'A101', durationDays: 9, isMilestone: false, earliestStart: 0 },
    { id: 'A102', durationDays: 0, isMilestone: true, earliestStart: 0 },
    { id: 'A103', durationDays: 11, isMilestone: false, earliestStart: 15 },  // model gate: dev free after 3rd week
    { id: 'A104', durationDays: 0, isMilestone: true, earliestStart: 0 },
    { id: 'A105', durationDays: 24, isMilestone: false, earliestStart: 15 },
    { id: 'A106', durationDays: 12, isMilestone: false, earliestStart: 0 },
    { id: 'A107', durationDays: 0, isMilestone: true, earliestStart: 0 },
    { id: 'A108', durationDays: 12, isMilestone: false, earliestStart: 0 },
    { id: 'A109', durationDays: 0, isMilestone: true, earliestStart: 0 }
  ],
  dependencies: [
    { from: 'A101', to: 'A102', type: 'FS', lagDays: 0, leadDays: 0 },
    { from: 'A101', to: 'A103', type: 'FS', lagDays: 0, leadDays: 0 },
    { from: 'A103', to: 'A104', type: 'FS', lagDays: 0, leadDays: 0 },
    { from: 'A101', to: 'A105', type: 'SS', lagDays: 5, leadDays: 0 },
    { from: 'A104', to: 'A106', type: 'FS', lagDays: 0, leadDays: 0 },
    { from: 'A106', to: 'A107', type: 'FS', lagDays: 0, leadDays: 0 },
    { from: 'A107', to: 'A108', type: 'FS', lagDays: 0, leadDays: 0 },
    { from: 'A108', to: 'A109', type: 'FS', lagDays: 0, leadDays: 0 }
  ]
};

var cpm = SL.computeCPM(schedule);
console.log('projectDuration (target was 50):', cpm.projectDuration);
console.log('critical path:', cpm.criticalPath.join(' → '));
console.log('');
console.log('ID     ES  EF  float  their-screenshot');
var theirs = { A101: [0, 9, 6], A102: [9, 9, 41], A103: [15, 26, 0], A104: [26, 26, 0], A105: [15, 39, 11], A106: [26, 38, 0], A107: [38, 38, 0], A108: [38, 50, 0], A109: [50, 50, 0] };
var fails = 0;
Object.keys(theirs).forEach(function (id) {
  var m = cpm.map[id], t = theirs[id];
  var ok = m.es === t[0] && m.ef === t[1] && m.float === t[2];
  if (!ok) fails++;
  console.log(id + '    ' + m.es + '  ' + m.ef + '  ' + m.float + '     theirs=' + t.join('/') + (ok ? '  MATCH' : '  DIFFER'));
});
// PERT checks from their sheet
var pert = [[6.8, 9, 11.3, 9], [8.8, 11, 13.2, 11], [19.6, 24, 28.4, 24], [9.6, 12, 14.4, 12]];
pert.forEach(function (p, i) {
  var e = SL.pertExpected(p[0], p[1], p[2]);
  var ok = e === p[3];
  if (!ok) fails++;
  console.log('PERT#' + (i + 1) + ': (' + p[0] + '+4*' + p[1] + '+' + p[2] + ')/6 = ' + e + ' vs shown ' + p[3] + (ok ? '  MATCH' : '  DIFFER'));
});
console.log(fails ? '\n' + fails + ' MISMATCHES' : '\nALL THEIR SHOWN NUMBERS VERIFIED CORRECT');
