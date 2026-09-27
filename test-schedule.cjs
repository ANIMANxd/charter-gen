// Test: enforcePlan must guarantee hard constraints regardless of model output
var fs = require('fs');
var vm = require('vm');
var moduleBox = { exports: {} };
vm.runInNewContext(fs.readFileSync('./js/schedule.js', 'utf8'),
  { module: moduleBox, exports: moduleBox.exports, console: console });
var SL = moduleBox.exports;

var fails = 0;
function check(label, cond, extra) {
  if (cond) { console.log('PASS  ' + label); }
  else { fails++; console.log('FAIL  ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

// --- Scenario: user asks for 10 weeks (50 working days), model returns ~10 working days ---
var schedule = {
  projectName: 'Test',
  methodology: 'Waterfall',
  plannedStart: '2026-09-01',
  plannedEnd: '2026-09-14',           // model thinks 2 weeks
  planScheduleManagement: { policy: 'x', tools: ['Jira'], roles: 'PM' },
  activities: [
    { id: 'A01', wbsId: '1.1', name: 'Requirements', description: 'd', isMilestone: false, estimationMethod: 'PERT', optimistic: 2, mostLikely: 3, pessimistic: 5, expectedDuration: 3.2, durationDays: 3, resources: ['BA'], constraint: '' },
    { id: 'A02', wbsId: '1.2', name: 'Design', description: 'd', isMilestone: false, estimationMethod: 'PERT', optimistic: 2, mostLikely: 3, pessimistic: 5, expectedDuration: 3.2, durationDays: 3, resources: ['Designer'], constraint: '' },
    { id: 'A03', wbsId: '2.1', name: 'Backend build', description: 'd', isMilestone: false, estimationMethod: 'PERT', optimistic: 1, mostLikely: 2, pessimistic: 4, expectedDuration: 2.2, durationDays: 2, resources: ['Backend dev'], constraint: '' },
    { id: 'A04', wbsId: '2.2', name: 'QA', description: 'd', isMilestone: false, estimationMethod: 'PERT', optimistic: 1, mostLikely: 2, pessimistic: 3, expectedDuration: 2, durationDays: 2, resources: ['QA engineer'], constraint: '' },
    { id: 'A05', wbsId: '3.1', name: 'M1', description: 'd', isMilestone: true, durationDays: 0, resources: [], constraint: '' }
  ],
  dependencies: [
    { from: 'A01', to: 'A02', type: 'FS', lagDays: 0, leadDays: 0 },
    { from: 'A02', to: 'A03', type: 'FS', lagDays: 0, leadDays: 0 },
    { from: 'A03', to: 'A04', type: 'FS', lagDays: 0, leadDays: 0 },
    { from: 'A04', to: 'A05', type: 'FS', lagDays: 0, leadDays: 0 }
  ],
  resourcePlan: { levelingNotes: '', smoothingNotes: '' },
  compression: { crashOptions: [], fastTrackOptions: [] },
  controlPlan: { baselineDate: '', varianceThreshold: '', velocityTarget: '', retrospectiveCadence: '', changeControlProcess: '' }
};

var inputs = {
  startDate: '2026-09-01',
  workingDays: '5',
  targetDays: 50,                                   // 10 weeks
  resourceAvailability: [{ name: 'Backend dev', days: 10 }]  // dev free only after 10 working days
};

var rep = SL.enforcePlan(schedule, inputs);

check('critical path == 50 working days (10 weeks)',
  schedule.projectDurationDays === 50,
  { actual: schedule.projectDurationDays });
check('report says target 50', rep.targetDays === 50, rep);
check('report says actual 50', rep.actualDays === 50, rep);
check('report.ok', rep.ok === true, rep);
check('plannedStart forced to user date', schedule.plannedStart === '2026-09-01', schedule.plannedStart);
check('plannedEnd recomputed after start', schedule.plannedEnd > '2026-09-14', schedule.plannedEnd);

var cpm = SL.computeCPM(schedule);
check('Backend dev activity starts on/after day 10 (gate enforced)',
  cpm.map['A03'].es >= 10, { es: cpm.map['A03'].es });
check('gate recorded in report', rep.gates.length === 1 && /Backend dev/.test(rep.gates[0]), rep.gates);
check('gate written into activity constraint',
  /available from day 10/.test(schedule.activities[2].constraint), schedule.activities[2].constraint);
check('QA must also be after backend (FS chain respected)', cpm.map['A04'].es >= 10 + schedule.activities[2].durationDays,
  { qaEs: cpm.map['A04'].es, backendDur: schedule.activities[2].durationDays });
check('PERT triple consistent: (O+4ML+P)/6 == duration for A01',
  Math.abs(SL.pertExpected(schedule.activities[0].optimistic, schedule.activities[0].mostLikely, schedule.activities[0].pessimistic) - schedule.activities[0].durationDays) < 0.06,
  schedule.activities[0]);
check('O <= ML <= P for all', schedule.activities.every(function (a) {
  return a.isMilestone || (a.optimistic <= a.mostLikely && a.mostLikely <= a.pessimistic);
}));
check('milestone still 0 days', schedule.activities[4].durationDays === 0);
check('milestone not gated', (schedule.activities[4].earliestStart || 0) === 0);
check('critical path reported', Array.isArray(schedule.criticalPath) && schedule.criticalPath.length > 0, schedule.criticalPath);

// --- Scenario 2: impossible gate (dev free at day 60 but target 50) → must report honestly, not lie ---
var s2 = JSON.parse(JSON.stringify(schedule));
var rep2 = SL.enforcePlan(s2, { startDate: '2026-09-01', workingDays: '5', targetDays: 50,
  resourceAvailability: [{ name: 'Backend dev', days: 60 }] });
check('impossible gate: report.ok = false (no lying)', rep2.ok === false, rep2);
check('impossible gate: actual >= 60 respected', s2.projectDurationDays >= 60, { actual: s2.projectDurationDays });
check('impossible gate: adjustment explains why', rep2.adjustments.length > 0, rep2.adjustments);

// --- Scenario 3: no constraints at all → sane defaults, no crash ---
var s3 = JSON.parse(JSON.stringify(schedule));
var rep3 = SL.enforcePlan(s3, {});
check('no-input run does not crash', !!s3.planCheck, rep3);
check('no-input run keeps positive duration', s3.projectDurationDays > 0, s3.projectDurationDays);

// --- Scenario 4: disconnected/orphan activity gets connected ---
var s4 = JSON.parse(JSON.stringify(schedule));
s4.activities.push({ id: 'A06', wbsId: '9.9', name: 'Orphan', description: '', isMilestone: false, durationDays: 2, resources: [], constraint: '' });
SL.enforcePlan(s4, { startDate: '2026-09-01', workingDays: '5', targetDays: 40 });
var hasPred = s4.dependencies.some(function (d) { return d.to === 'A06'; });
check('orphan activity connected to network', hasPred, s4.dependencies);

// --- Scenario 5: model returns garbage durations (0 / negative / NaN) ---
var s5 = JSON.parse(JSON.stringify(schedule));
s5.activities[0].durationDays = -5;
s5.activities[1].durationDays = 0;
s5.activities[2].durationDays = 'abc';
SL.enforcePlan(s5, { startDate: '2026-09-01', workingDays: '5', targetDays: 30 });
check('garbage durations sanitized to >= 1', s5.activities.slice(0, 3).every(function (a) { return a.durationDays >= 1; }),
  s5.activities.slice(0, 3).map(function (a) { return a.durationDays; }));
check('garbage case still hits 30-day target', s5.projectDurationDays === 30, s5.projectDurationDays);

console.log('\n' + (fails === 0 ? 'ALL TESTS PASSED' : fails + ' TEST(S) FAILED'));
process.exit(fails === 0 ? 0 : 1);
